export type Point = { x: number; y: number };

// Convert points array to SVG path
export const pointsToPath = (points: Point[]) => {
  if (points.length === 0) return "";
  if (points.length < 2) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const nextP = points[i + 1];
    const midX = (p.x + nextP.x) / 2;
    const midY = (p.y + nextP.y) / 2;
    d += ` Q ${p.x} ${p.y}, ${midX} ${midY}`;
  }

  const lastP = points[points.length - 1];
  d += ` L ${lastP.x} ${lastP.y}`;

  return d;
};
