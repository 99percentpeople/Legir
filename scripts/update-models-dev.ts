/** Regenerate the offline snapshot; provider/model names are never hand-maintained. */
import { parseModelsDevCatalog } from "../src/services/ai/providers/modelsDev";
const source = process.argv[2];
const input = source
  ? await Bun.file(source).json()
  : await (await fetch("https://models.dev/api.json")).json();
const catalog = parseModelsDevCatalog(input);
await Bun.write(
  new URL(
    "../src/services/ai/providers/models-dev.snapshot.json",
    import.meta.url,
  ),
  JSON.stringify(catalog) + "\n",
);
console.log(`Saved ${Object.keys(catalog).length} providers from models.dev.`);
