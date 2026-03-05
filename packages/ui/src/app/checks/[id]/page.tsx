import fs from "fs";
import path from "path";
import yaml from "yaml";
import { slugify } from "@healthz/types";
import CheckDetail from "./check-detail";

export function generateStaticParams() {
  const configPath = path.join(process.cwd(), "../../healthz.yaml");
  const config = yaml.parse(fs.readFileSync(configPath, "utf-8"));
  return config.checks.map((check: { name: string }) => ({
    id: slugify(check.name),
  }));
}

export default async function CheckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CheckDetail id={id} />;
}
