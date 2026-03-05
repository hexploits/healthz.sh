export const REGION_NAMES: Record<string, string> = {
  // US East
  "us-east-1": "N. Virginia",
  "us-east-2": "Ohio",
  // US West
  "us-west-1": "N. California",
  "us-west-2": "Oregon",
  // Canada
  "ca-central-1": "Montreal",
  "ca-west-1": "Calgary",
  // South America
  "sa-east-1": "São Paulo",
  // Europe
  "eu-west-1": "Dublin",
  "eu-west-2": "London",
  "eu-west-3": "Paris",
  "eu-central-1": "Frankfurt",
  "eu-central-2": "Zurich",
  "eu-north-1": "Stockholm",
  "eu-south-1": "Milan",
  "eu-south-2": "Spain",
  // Middle East
  "me-south-1": "Bahrain",
  "me-central-1": "UAE",
  "il-central-1": "Tel Aviv",
  // Africa
  "af-south-1": "Cape Town",
  // Asia Pacific
  "ap-east-1": "Hong Kong",
  "ap-south-1": "Mumbai",
  "ap-south-2": "Hyderabad",
  "ap-southeast-1": "Singapore",
  "ap-southeast-2": "Sydney",
  "ap-southeast-3": "Jakarta",
  "ap-southeast-4": "Melbourne",
  "ap-southeast-5": "Malaysia",
  "ap-southeast-7": "Thailand",
  "ap-northeast-1": "Tokyo",
  "ap-northeast-2": "Seoul",
  "ap-northeast-3": "Osaka",
  // China
  "cn-north-1": "Beijing",
  "cn-northwest-1": "Ningxia",
  // GovCloud
  "us-gov-west-1": "US-West (GovCloud)",
  "us-gov-east-1": "US-East (GovCloud)",
  // Mexico
  "mx-central-1": "Mexico City",
  // New Zealand
  "ap-southeast-6": "Auckland",
  // Taiwan
  "ap-east-2": "Taipei",
};

export const REGION_COLORS: Record<string, string> = {
  "us-east-1": "#60a5fa",
  "us-east-2": "#3b82f6",
  "us-west-1": "#818cf8",
  "us-west-2": "#34d399",
  "ca-central-1": "#6ee7b7",
  "ca-west-1": "#a7f3d0",
  "sa-east-1": "#fcd34d",
  "eu-west-1": "#fbbf24",
  "eu-west-2": "#f472b6",
  "eu-west-3": "#c084fc",
  "eu-central-1": "#f87171",
  "eu-central-2": "#fb923c",
  "eu-north-1": "#38bdf8",
  "eu-south-1": "#e879f9",
  "eu-south-2": "#d946ef",
  "me-south-1": "#facc15",
  "me-central-1": "#fde047",
  "il-central-1": "#a3e635",
  "af-south-1": "#4ade80",
  "ap-east-1": "#f97316",
  "ap-south-1": "#a78bfa",
  "ap-south-2": "#8b5cf6",
  "ap-southeast-1": "#14b8a6",
  "ap-southeast-2": "#2dd4bf",
  "ap-southeast-3": "#5eead4",
  "ap-southeast-4": "#99f6e4",
  "ap-southeast-5": "#0d9488",
  "ap-northeast-1": "#fb923c",
  "ap-northeast-2": "#fdba74",
  "ap-northeast-3": "#fed7aa",
  "cn-north-1": "#ef4444",
  "cn-northwest-1": "#dc2626",
};

export function regionLabel(region: string): string {
  return REGION_NAMES[region] || region;
}

export function getColor(region: string): string {
  return REGION_COLORS[region] || "#94a3b8";
}
