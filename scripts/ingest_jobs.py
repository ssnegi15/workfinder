import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
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


def normalize(source, source_id, title, company, location, url, description):
    experience, category = metadata(description)
    return {
        "id": str(source_id), "title": title or "Unknown title", "company": company,
        "location": location or "Not specified",
        "remote_status": "remote" if "remote" in (location or "").lower() else "on-site",
        "url": url or "", "source": source, "description": description,
        "discovered_at": datetime.now(timezone.utc).isoformat(),
        "experience": experience, "category": category,
    }


def main():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    jobs = json.loads(DATA_FILE.read_text()) if DATA_FILE.exists() else []
    known = {(job.get("source", ""), str(job.get("id", ""))) for job in jobs}
    added = 0

    for token, company in GREENHOUSE:
        try:
            payload = fetch_json(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true")
            for role in payload.get("jobs", []):
                key = ("greenhouse", str(role.get("id", "")))
                if key in known:
                    continue
                description = plain_text(role.get("content", ""))
                jobs.append(normalize("greenhouse", role.get("id"), role.get("title"), company,
                                      (role.get("location") or {}).get("name", ""),
                                      role.get("absolute_url", ""), description))
                known.add(key)
                added += 1
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as error:
            print(f"Skipped Greenhouse board {company}: {error}")

    for token, company in LEVER:
        try:
            payload = fetch_json(f"https://api.lever.co/v0/postings/{token}")
            for role in payload if isinstance(payload, list) else []:
                key = ("lever", str(role.get("id", "")))
                if key in known:
                    continue
                description = plain_text(role.get("description", ""))
                location = (role.get("categories") or {}).get("location", "")
                jobs.append(normalize("lever", role.get("id"), role.get("text"), company,
                                      location, role.get("hostedUrl", ""), description))
                known.add(key)
                added += 1
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as error:
            print(f"Skipped Lever board {company}: {error}")

    DATA_FILE.write_text(json.dumps(jobs, indent=2, ensure_ascii=False) + "\n")
    print(f"Added {added} listings. {len(jobs)} total listings saved to {DATA_FILE.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()