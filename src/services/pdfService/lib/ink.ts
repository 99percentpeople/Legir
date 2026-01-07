import { PDFDict, PDFName, PDFStream } from "@cantoo/pdf-lib";

export const generateInkAppearanceOps = (
  points: { x: number; y: number }[],
  color: { red: number; green: number; blue: number },
  thickness: number,
  options?: { lineCap?: 0 | 1 | 2; lineJoin?: 0 | 1 | 2 },
) => {
  if (points.length < 2) return undefined;

  const operators: string[] = [];

  operators.push(`${color.red} ${color.green} ${color.blue} RG`);
  operators.push(`${thickness} w`);
  operators.push(`${options?.lineCap ?? 1} J`);
  operators.push(`${options?.lineJoin ?? 1} j`);

  operators.push(`${points[0].x} ${points[0].y} m`);

  if (points.length === 2) {
    operators.push(`${points[1].x} ${points[1].y} l`);
  } else {
    let currentPoint = points[0];

    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const nextP = points[i + 1];
      const midX = (p.x + nextP.x) / 2;
      const midY = (p.y + nextP.y) / 2;
      const mid = { x: midX, y: midY };

      const cp1x = currentPoint.x + (2 / 3) * (p.x - currentPoint.x);
      const cp1y = currentPoint.y + (2 / 3) * (p.y - currentPoint.y);
      const cp2x = mid.x + (2 / 3) * (p.x - mid.x);
      const cp2y = mid.y + (2 / 3) * (p.y - mid.y);

      operators.push(`${cp1x} ${cp1y} ${cp2x} ${cp2y} ${mid.x} ${mid.y} c`);

      currentPoint = mid;
    }

    const lastP = points[points.length - 1];
    operators.push(`${lastP.x} ${lastP.y} l`);
  }

  operators.push(`S`);

  return operators.join("\n");
};

export const extractInkAppearance = (
  annot: PDFDict,
  transformPoint: (x: number, y: number) => [number, number],
): { strokePaths: string[]; rawStrokeStreams: string[] } => {
  const strokePaths: string[] = [];
  const rawStrokeStreams: string[] = [];
  try {
    const AP = annot.lookup(PDFName.of("AP"));
    if (AP instanceof PDFDict) {
      const N = AP.lookup(PDFName.of("N"));
      if (N instanceof PDFStream) {
        const contents = N.getContents();
        const str = new TextDecoder().decode(contents);

        const ops = str.split("\n");
        let currentPath = "";
        let currentRawOps: string[] = [];

        for (const op of ops) {
          const parts = op.trim().split(/\s+/);
          if (parts.length === 0) continue;
          const cmd = parts[parts.length - 1];

          if (cmd === "m" && parts.length >= 3) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            const [vx, vy] = transformPoint(x, y);
            currentPath += `M ${vx} ${vy} `;
            currentRawOps.push(op);
          } else if (cmd === "l" && parts.length >= 3) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            const [vx, vy] = transformPoint(x, y);
            currentPath += `L ${vx} ${vy} `;
            currentRawOps.push(op);
          } else if (cmd === "c" && parts.length >= 7) {
            const [x1, y1] = transformPoint(
              parseFloat(parts[0]),
              parseFloat(parts[1]),
            );
            const [x2, y2] = transformPoint(
              parseFloat(parts[2]),
              parseFloat(parts[3]),
            );
            const [x3, y3] = transformPoint(
              parseFloat(parts[4]),
              parseFloat(parts[5]),
            );
            currentPath += `C ${x1} ${y1} ${x2} ${y2} ${x3} ${y3} `;
            currentRawOps.push(op);
          } else if (cmd === "S") {
            if (currentPath) {
              strokePaths.push(currentPath.trim());
              currentPath = "";
              currentRawOps.push(op);
              rawStrokeStreams.push(currentRawOps.join("\n"));
              currentRawOps = [];
            }
          }
        }

        if (currentPath.trim()) {
          strokePaths.push(currentPath.trim());
          if (currentRawOps.length > 0) {
            if (!currentRawOps[currentRawOps.length - 1].endsWith("S")) {
              currentRawOps.push("S");
            }
            rawStrokeStreams.push(currentRawOps.join("\n"));
          }
        }
      }
    }
  } catch (e) {
    // Ignore
  }
  return { strokePaths, rawStrokeStreams };
};
