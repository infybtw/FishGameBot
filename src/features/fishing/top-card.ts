import { type TopFisherRow } from "../../db/index.ts";
import { round2 } from "../../lib/format.ts";

const WIDTH = 1080;
const HEADER_HEIGHT = 238;
const ROW_HEIGHT = 98;
const FOOTER_HEIGHT = 126;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function formatValue(value: number): string {
  return `${round2(value).toLocaleString("ru-RU")} руб.`;
}

function rankColor(rank: number): string {
  if (rank === 1) return "#ffd166";
  if (rank === 2) return "#9ad5df";
  if (rank === 3) return "#f4976c";
  return "#36c5c9";
}

export function topCardSvg(rows: readonly TopFisherRow[]): string {
  const height = HEADER_HEIGHT + Math.max(rows.length, 1) * ROW_HEIGHT + FOOTER_HEIGHT;
  const leaderTotal = rows[0]?.total ?? 0;
  const renderedRows = rows.length === 0
    ? `<text x="64" y="${HEADER_HEIGHT + 58}" class="empty">Топ инвентарей пока пустует</text>`
    : rows
        .map((row, index) => {
          const rank = index + 1;
          const y = HEADER_HEIGHT + index * ROW_HEIGHT;
          const color = rankColor(rank);
          const ratio = leaderTotal > 0 ? Math.max(0.08, row.total / leaderTotal) : 0.08;
          const barWidth = Math.round(330 * ratio);
          const rankLabel = rank <= 3
            ? `<circle cx="91" cy="${y + 43}" r="25" fill="${color}"/><text x="91" y="${y + 52}" text-anchor="middle" class="rankTop">${rank}</text>`
            : `<text x="91" y="${y + 52}" text-anchor="middle" class="rank">${rank}</text>`;
          return `<rect x="50" y="${y + 8}" width="980" height="72" rx="22" fill="#12344a"/>${rankLabel}<text x="142" y="${y + 53}" class="name">${escapeXml(truncate(row.firstName, 20))}</text><rect x="482" y="${y + 29}" width="330" height="18" rx="9" fill="#0b2538"/><rect x="482" y="${y + 29}" width="${barWidth}" height="18" rx="9" fill="${color}"/><text x="852" y="${y + 53}" class="value">${escapeXml(formatValue(row.total))}</text>`;
        })
        .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <style>
    text { font-family: DejaVu Sans, sans-serif; dominant-baseline: alphabetic; }
    .title { fill: #e8fbff; font-size: 42px; font-weight: 800; letter-spacing: 1px; }
    .subtitle, .rank, .empty, .footer { fill: #95bdc8; font-size: 22px; }
    .name, .value { fill: #f2feff; font-size: 26px; font-weight: 700; }
    .rankTop { fill: #092237; font-size: 25px; font-weight: 800; }
  </style>
  <rect width="100%" height="100%" fill="#082235"/>
  <path d="M0 0H1080V154C930 192 806 108 628 148C443 190 276 226 0 169Z" fill="#0d3048"/>
  <circle cx="971" cy="74" r="92" fill="#16455d" opacity=".7"/>
  <text x="64" y="78" class="title">ТОП РЫБАКОВ</text>
  <text x="64" y="118" class="subtitle">Кто собрал самую ценную добычу · топ-10</text>
  ${renderedRows}
  <path d="M0 ${height - 86}C198 ${height - 134} 352 ${height - 55} 566 ${height - 91}C770 ${height - 126} 920 ${height - 54} 1080 ${height - 100}V${height}H0Z" fill="#0d3048"/>
  <text x="64" y="${height - 47}" class="footer">@fishcatcherrbot · стоимость доступных рыб</text>
</svg>`;
}

/** Renders SVG with rsvg-convert while keeping both source and PNG in memory. */
export async function createTopCard(rows: readonly TopFisherRow[]): Promise<Uint8Array> {
  const process = Bun.spawn(["rsvg-convert", "--format", "png"], {
    stdin: new Response(topCardSvg(rows)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [png, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Could not render fishtop card: ${stderr.trim()}`);
  return new Uint8Array(png);
}
