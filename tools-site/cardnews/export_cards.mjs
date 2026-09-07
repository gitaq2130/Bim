#!/usr/bin/env node
/** cards.config.mjs 의 문구를 render_cards.py 가 읽을 JSON 으로 내보낸다. */
import { writeFile } from "node:fs/promises";
import { CARDS } from "./cards.config.mjs";

await writeFile("cards.json", JSON.stringify(CARDS, null, 2), "utf8");
console.log(`exported ${CARDS.length} card sets → cards.json`);
