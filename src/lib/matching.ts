import type { Job } from "@/lib/types";

const roleWeights: Record<string, number> = {
  "principal software engineer": 40,
  "staff software engineer": 39,
  "software architect": 38,
  "associate director": 37,
  "senior engineering manager": 36,
  "engineering manager": 32,
};

const keywordWeights: Record<string, number> = {
  architecture: 5,
  "system design": 5,
  "distributed systems": 5,
  scalability: 5,
  cloud: 4,
  aws: 4,
  azure: 4,
  gcp: 4,
  kubernetes: 4,
  microservices: 4,
  "full stack": 4,
  "technical leadership": 5,
  platform: 3,
  backend: 3,
  api: 2,
};

export interface CareerPreferences {
  roles: string;
  location: string;
  skills: string;
  experience: string;
}

export const defaultPreferences: CareerPreferences = {
  roles:
    "Principal Software Engineer, Staff Software Engineer, Software Architect, Associate Director, Senior Engineering Manager",
  location: "Remote India",
  skills:
    "Full Stack, Software Architecture, Distributed Systems, Cloud, Backend Engineering, System Design, Technical Leadership, Microservices, API Design, Scalability",
  experience: "10+ years",
};

export function scoreJob(job: Job, preferences: CareerPreferences): number {
  const title = job.title.toLowerCase();
  const description = job.description.toLowerCase();
  const location = `${job.location} ${job.remote_status ?? ""}`.toLowerCase();
  let total = 0;

  for (const [role, weight] of Object.entries(roleWeights)) {
    if (title.includes(role)) {
      total += weight;
      break;
    }
  }

  for (const [keyword, weight] of Object.entries(keywordWeights)) {
    if (description.includes(keyword)) total += weight;
  }

  if (location.includes("remote")) total += 8;
  if (location.includes("india")) total += 8;
  if (description.includes("remote")) total += 5;
  if (description.includes("india")) total += 5;

  if (description.includes("relocation required")) total -= 25;
  if (description.includes("onsite only")) total -= 25;
  if (description.includes("0-3 years")) total -= 20;

  const requestedRoles = preferences.roles
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
  if (requestedRoles.some((role) => title.includes(role))) total += 8;

  const requestedLocation = preferences.location.trim().toLowerCase();
  if (requestedLocation && location.includes(requestedLocation)) total += 8;

  const requestedSkills = preferences.skills
    .split(",")
    .map((skill) => skill.trim().toLowerCase())
    .filter(Boolean);
  total +=
    requestedSkills.filter((skill) => description.includes(skill)).length * 3;

  return Math.max(0, Math.min(100, total));
}

export function plainText(value: string): string {
  return value
    .replaceAll("\u00e2\u0080\u0099", "\u2019")
    .replaceAll("\u00e2\u0080\u0094", "\u2014")
    .replaceAll("\u00e2\u0080\u0093", "\u2013")
    .replaceAll("\u00e2\u0080\u009c", "\u201c")
    .replaceAll("\u00e2\u0080\u009d", "\u201d")
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
