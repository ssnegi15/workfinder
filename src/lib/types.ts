export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  remote_status?: string;
  url: string;
  source: string;
  description: string;
  discovered_at: string;
  relevance_score?: number;
  score?: number;
  category?: string;
  experience?: string;
}
