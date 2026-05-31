import type { WikiOutput, WikiPage } from "@open-zread/types";
import { loadConfig, generateWikiJson, finalizeWiki, getWikiDir } from "@open-zread/utils";

/**
 * Persist edited catalog pages: rewrite wiki.json then re-run finalize
 * (sidebar + index + glossary page). Reuses already-tested utils.
 */
export async function persistCatalog(output: WikiOutput, pages: WikiPage[]): Promise<void> {
  const config = await loadConfig();
  await generateWikiJson(pages, config, output.techStackSummary, output.glossary);
  await finalizeWiki(getWikiDir(), { pages, glossary: output.glossary });
}
