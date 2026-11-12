function renderOpeningFlyer(
  opening,
  canvas = document.querySelector("#opening-flyer")
) {
  const ctx = canvas.getContext("2d");

  const colors = {
    cream: "#f6efe5",
    paper: "#fffdf9",
    ink: "#2c2119",
    muted: "#6b594b",
    accent: "#9e371d",
    peach: "#f9dfd1",
    border: "#e8d9c8",
  };

  function roundedBox(x, y, width, height, radius, color) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function wrapText(value, maxWidth) {
    const lines = [];
    let line = "";

    for (const word of String(value).trim().split(/\s+/)) {
      if (!word) continue;

      const candidate = line ? `${line} ${word}` : word;

      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) lines.push(line);
      line = "";

      for (const character of Array.from(word)) {
        if (line && ctx.measureText(line + character).width > maxWidth) {
          lines.push(line);
          line = "";
        }

        line += character;
      }
    }

    if (line) lines.push(line);
    return lines;
  }

  function drawLines(lines, x, y, maxWidth, lineHeight, maxLines) {
    const visible = lines.slice(0, maxLines);

    if (lines.length > maxLines) {
      const last = Array.from(visible[maxLines - 1]);

      while (
        last.length &&
        ctx.measureText(`${last.join("")}…`).width > maxWidth
      ) {
        last.pop();
      }

      visible[maxLines - 1] = `${last.join("").trimEnd()}…`;
    }

    visible.forEach((line, index) => {
      ctx.fillText(line, x, y + index * lineHeight);
    });

    return visible.length;
  }

  const appointment = new Date(opening.startsAt);

  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(appointment);

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
  }).format(appointment);

  const price = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
  }).format(Number(opening.price));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = colors.cream;
  ctx.fillRect(0, 0, 1080, 1080);
  roundedBox(48, 48, 984, 984, 36, colors.paper);

  // Dark header with rounded top corners.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(48, 48, 984, 984, 36);
  ctx.clip();
  ctx.fillStyle = colors.ink;
  ctx.fillRect(48, 48, 984, 496);
  ctx.restore();

  ctx.fillStyle = colors.paper;
  ctx.font = "bold 34px Georgia";
  ctx.fillText("SlotBack", 96, 120);

  const dotX = 96 + ctx.measureText("SlotBack").width;
  ctx.fillStyle = colors.peach;
  ctx.fillText(".", dotX, 120);

  const badge = "APPOINTMENT AVAILABLE";
  ctx.font = "bold 19px Arial";
  const badgeWidth = ctx.measureText(badge).width + 40;
  roundedBox(96, 162, badgeWidth, 46, 23, colors.peach);

  ctx.fillStyle = colors.accent;
  ctx.fillText(badge, 116, 192);

  // Fit the service title into up to three lines.
  let titleSize = 70;
  let titleLines;

  while (true) {
    ctx.font = `bold ${titleSize}px Georgia`;
    titleLines = wrapText(opening.serviceName, 888);

    if (titleLines.length <= 3 || titleSize === 46) break;
    titleSize -= 2;
  }

  ctx.fillStyle = colors.paper;
  const titleY = 293;
  const titleLineHeight = titleSize + 6;
  const titleLineCount = drawLines(
    titleLines, 96, titleY, 888, titleLineHeight, 3
  );

  const businessY = titleY + (titleLineCount - 1) * titleLineHeight + 38;
  ctx.font = "28px Arial";
  ctx.fillStyle = colors.peach;
  drawLines(wrapText(opening.businessName, 888), 96, businessY, 888, 32, 2);

  ctx.font = "bold 19px Arial";
  ctx.fillStyle = colors.accent;
  ctx.fillText("WHEN", 96, 603);

  ctx.fillStyle = colors.ink;
  ctx.font = "bold 38px Georgia";
  ctx.fillText(`${date} · ${time} WAT`, 96, 655, 888);

  ctx.fillStyle = colors.muted;
  ctx.font = "25px Arial";
  ctx.fillText(`${opening.durationMinutes} minutes`, 96, 694);

  ctx.fillStyle = colors.border;
  ctx.fillRect(96, 724, 888, 2);

  ctx.font = "bold 19px Arial";
  ctx.fillStyle = colors.accent;
  ctx.fillText("WHERE", 96, 773);
  ctx.fillText("PRICE", 640, 773);

  ctx.font = "28px Arial";
  ctx.fillStyle = colors.ink;
  drawLines(wrapText(opening.location, 500), 96, 817, 500, 34, 2);

  ctx.font = "bold 44px Georgia";
  ctx.fillStyle = colors.accent;
  ctx.fillText(price, 640, 822, 344);

  roundedBox(96, 900, 888, 92, 20, colors.peach);

  ctx.font = "bold 24px Arial";
  ctx.fillStyle = colors.ink;
  ctx.fillText("Request this opening", 122, 938);

  ctx.font = "21px Arial";
  ctx.fillStyle = colors.muted;
  ctx.fillText("The business confirms your booking.", 122, 971);

  return canvas.toDataURL("image/jpeg", 0.92);
}