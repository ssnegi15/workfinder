import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "src" / "data" / "jobs.json"
GREENHOUSE = [
    ("microsoft", "Microsoft"), ("adobe", "Adobe"), ("google", "Google"),
    ("nvidia", "Nvidia"), ("openai", "OpenAI"), ("appliedintuition", "Applied Intuition"),
    ("paloaltonetworks", "Palo Alto Networks"), ("paytm", "Paytm"), ("ixigo", "Ixigo"),
    ("makemytrip", "MakeMyTrip"), ("airtel", "Airtel"), ("zomato", "Zomato"),
    ("blinkit", "Blinkit"), ("policybazaar", "PolicyBazaar"), ("chegg", "Chegg"),
    ("metlife", "MetLife"), ("optum", "Optum"), ("expedia", "Expedia"),
    ("salesforce", "Salesforce"), ("servicenow", "ServiceNow"), ("atlassian", "Atlassian"),
    ("twilio", "Twilio"), ("hubspot", "HubSpot"), ("stripe", "Stripe"), ("cloudera", "Cloudera"),
]
LEVER = [
    ("palantir", "Palantir"), ("anduril", "Anduril"), ("anthropic", "Anthropic"),
    ("cohere", "Cohere"), ("fidelity", "Fidelity"), ("docker", "Docker"), ("figma", "Figma"),
    ("notion", "Notion"), ("urbancompany", "Urban Company"), ("juspay", "Juspay"),
    ("postman", "Postman"), ("razorpay", "Razorpay"), ("cred", "CRED"), ("meesho", "Meesho"),
    ("groww", "Groww"), ("codenation", "CodeNation"), ("thoughtworks", "Thoughtworks"),
    ("nagaro", "Nagarro"), ("bolt", "Bolt"), ("clutter", "Clutter"), ("6sense", "6sense"),
    ("asana", "Asana"), ("benchling", "Benchling"), ("datadog", "DataDog"), ("github", "GitHub"),
]


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        text = " ".join(data.split())
        if text:
            self.parts.append(text)


def plain_text(content):
    if not isinstance(content, str):
        content = ""
    parser = TextExtractor()
    parser.feed(content or "")
    return " ".join(parser.parts)


def fetch_json(url):
    request = Request(url, headers={"User-Agent": "Workfinder/1.0 (open-source job index)"})
    with urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def metadata(description):
    text = description.lower()
    years = re.search(r"(\d+\s*(?:-|to|\+)\s*\d*\s*years?|\d+\+?\s*years?)", text)
    tags = []
    if any(word in text for word in (".net", "c#", "asp.net", "dotnet")):
        tags.append(".NET")
    if any(word in text for word in ("react", "next.js", "typescript", "frontend")):
        tags.append("React")
    if any(word in text for word in ("ai", "ml", "llm", "openai", "nlp", "machine learning")):
        tags.append("AI")
    if any(word in text for word in ("azure", "aws", "gcp")):
        tags.append("Cloud")
    return (years.group(1).upper() if years else "Not specified", ",".join(tags) or "Software")


def safe_listing_url(value):
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlsplit(value)
        if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password:
            return value
    except ValueError:
        pass
    return ""


def normalize(source, source_id, title, company, location, url, description):
    title = title.strip() if isinstance(title, str) else ""
    location = location.strip() if isinstance(location, str) else ""
    experience, category = metadata(description)
    return {
        "id": str(source_id), "title": title or "Unknown title", "company": company,
        "location": location or "Not specified",
        "remote_status": "remote" if "remote" in (location or "").lower() else "on-site",
        "url": safe_listing_url(url), "source": source, "description": description,
        "discovered_at": datetime.now(timezone.utc).isoformat(),
        "experience": experience, "category": category,
    }


def reconcile_jobs(existing_jobs, refreshed_boards, fetched_jobs):
    refreshed_boards = set(refreshed_boards)
    fresh_by_key = {
        (job.get("source", ""), job.get("company", ""), str(job.get("id", ""))): job
        for job in fetched_jobs
    }
    reconciled = []

    for existing in existing_jobs:
        key = (
            existing.get("source", ""),
            existing.get("company", ""),
            str(existing.get("id", "")),
        )
        board = key[:2]
        if board not in refreshed_boards:
            reconciled.append(existing)
            continue

        fresh = fresh_by_key.pop(key, None)
        if fresh is not None:
            fresh["discovered_at"] = existing.get("discovered_at") or fresh["discovered_at"]
            reconciled.append(fresh)

    reconciled.extend(fresh_by_key.values())
    return reconciled


def main():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    jobs = json.loads(DATA_FILE.read_text()) if DATA_FILE.exists() else []
    existing_by_key = {
        (job.get("source", ""), job.get("company", ""), str(job.get("id", ""))): job
        for job in jobs
    }
    refreshed_boards = set()
    fetched_jobs = []
    added = 0

    for token, company in GREENHOUSE:
        try:
            payload = fetch_json(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true")
            roles = payload.get("jobs") if isinstance(payload, dict) else None
            if not isinstance(roles, list):
                raise ValueError("Unexpected Greenhouse response format")
            board_jobs = {}
            for role in roles:
                if not isinstance(role, dict) or role.get("id") is None:
                    raise ValueError("Unexpected Greenhouse job format")
                location = role.get("location")
                location_name = location.get("name", "") if isinstance(location, dict) else ""
                description = plain_text(role.get("content", ""))
                job = normalize("greenhouse", role.get("id"), role.get("title"), company,
                                location_name, role.get("absolute_url", ""), description)
                key = ("greenhouse", company, str(role["id"]))
                board_jobs[key] = job
            refreshed_boards.add(("greenhouse", company))
            for key, job in board_jobs.items():
                if existing_by_key.get(key) is None:
                    added += 1
                fetched_jobs.append(job)
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError, TypeError) as error:
            print(f"Skipped Greenhouse board {company}: {error}")

    for token, company in LEVER:
        try:
            payload = fetch_json(f"https://api.lever.co/v0/postings/{token}")
            if not isinstance(payload, list):
                raise ValueError("Unexpected Lever response format")
            board_jobs = {}
            for role in payload:
                if not isinstance(role, dict) or role.get("id") is None:
                    raise ValueError("Unexpected Lever job format")
                description = plain_text(role.get("description", ""))
                categories = role.get("categories")
                location = categories.get("location", "") if isinstance(categories, dict) else ""
                job = normalize("lever", role.get("id"), role.get("text"), company,
                                location, role.get("hostedUrl", ""), description)
                key = ("lever", company, str(role["id"]))
                board_jobs[key] = job
            refreshed_boards.add(("lever", company))
            for key, job in board_jobs.items():
                if existing_by_key.get(key) is None:
                    added += 1
                fetched_jobs.append(job)
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError, TypeError) as error:
            print(f"Skipped Lever board {company}: {error}")

    jobs = reconcile_jobs(jobs, refreshed_boards, fetched_jobs)
    DATA_FILE.write_text(json.dumps(jobs, indent=2, ensure_ascii=False) + "\n")
    print(f"Added {added} listings. {len(jobs)} total listings saved to {DATA_FILE.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()