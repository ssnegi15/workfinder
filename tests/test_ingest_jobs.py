import unittest

from scripts.ingest_jobs import normalize, reconcile_jobs


class IngestionTests(unittest.TestCase):
    def test_reconcile_updates_and_removes_only_successfully_refreshed_board(self):
        existing = [
            {
                "source": "greenhouse",
                "company": "Acme",
                "id": "1",
                "title": "Old title",
                "discovered_at": "2026-01-01T00:00:00+00:00",
            },
            {"source": "greenhouse", "company": "Acme", "id": "2"},
            {"source": "lever", "company": "Other", "id": "3"},
        ]
        fetched = [
            {
                "source": "greenhouse",
                "company": "Acme",
                "id": "1",
                "title": "Updated title",
                "discovered_at": "2026-10-01T00:00:00+00:00",
            },
            {
                "source": "greenhouse",
                "company": "Acme",
                "id": "4",
                "title": "New role",
                "discovered_at": "2026-10-01T00:00:00+00:00",
            },
        ]

        jobs = reconcile_jobs(existing, {("greenhouse", "Acme")}, fetched)
        by_id = {job["id"]: job for job in jobs}

        self.assertEqual(set(by_id), {"1", "3", "4"})
        self.assertEqual(by_id["1"]["title"], "Updated title")
        self.assertEqual(by_id["1"]["discovered_at"], existing[0]["discovered_at"])

    def test_normalize_rejects_non_https_listing_urls(self):
        job = normalize(
            "greenhouse",
            1,
            "Role",
            "Acme",
            "Remote",
            "javascript:alert(1)",
            "Description",
        )
        self.assertEqual(job["url"], "")


if __name__ == "__main__":
    unittest.main()