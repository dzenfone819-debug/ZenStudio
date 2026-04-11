const svgNs = "http://www.w3.org/2000/svg";

function createSvgElement(name, attrs = {}) {
  const element = document.createElementNS(svgNs, name);

  Object.entries(attrs).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });

  return element;
}

function buildToroid() {
  const svg = document.getElementById("toroid-svg");

  if (!svg) {
    return;
  }

  svg.replaceChildren();

  const width = 480;
  const height = 290;
  const centerX = width / 2;
  const centerY = height / 2 - 2;
  const R = 120;
  const r = 56;
  const rotX = 1.18;
  const rotZ = -0.18;

  function project(x, y, z) {
    const y1 = y * Math.cos(rotX) - z * Math.sin(rotX);
    const z1 = y * Math.sin(rotX) + z * Math.cos(rotX);

    const x2 = x * Math.cos(rotZ) - y1 * Math.sin(rotZ);
    const y2 = x * Math.sin(rotZ) + y1 * Math.cos(rotZ);

    const depth = 1 + z1 / 520;
    return {
      x: centerX + x2 * depth,
      y: centerY + y2 * depth,
      z: z1
    };
  }

  function torusPoint(u, v) {
    return project(
      (R + r * Math.cos(v)) * Math.cos(u),
      r * Math.sin(v),
      (R + r * Math.cos(v)) * Math.sin(u)
    );
  }

  function pathFromPoints(points) {
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
  }

  const defs = createSvgElement("defs");
  const glow = createSvgElement("filter", {
    id: "soft-glow",
    x: "-50%",
    y: "-50%",
    width: "200%",
    height: "200%"
  });
  glow.append(
    createSvgElement("feGaussianBlur", {
      stdDeviation: "3.2",
      result: "blur"
    }),
    createSvgElement("feMerge")
  );
  const merge = glow.lastChild;
  merge.append(
    createSvgElement("feMergeNode", { in: "blur" }),
    createSvgElement("feMergeNode", { in: "SourceGraphic" })
  );
  defs.append(glow);
  svg.append(defs);

  svg.append(
    createSvgElement("ellipse", {
      cx: centerX,
      cy: centerY + 4,
      rx: "112",
      ry: "46",
      fill: "rgba(8, 8, 19, 0.82)"
    })
  );

  const gridGroup = createSvgElement("g", {
    stroke: "#e7d59a",
    "stroke-width": "1.05",
    fill: "none",
    opacity: "0.76"
  });

  for (let i = 0; i < 18; i += 1) {
    const u = (i / 18) * Math.PI * 2;
    const points = [];

    for (let step = 0; step <= 70; step += 1) {
      points.push(torusPoint(u, (step / 70) * Math.PI * 2));
    }

    gridGroup.append(
      createSvgElement("path", {
        d: pathFromPoints(points),
        opacity: (0.2 + Math.abs(Math.cos(u)) * 0.42).toFixed(2)
      })
    );
  }

  for (let i = 0; i < 24; i += 1) {
    const v = (i / 24) * Math.PI * 2;
    const points = [];

    for (let step = 0; step <= 120; step += 1) {
      points.push(torusPoint((step / 120) * Math.PI * 2, v));
    }

    gridGroup.append(
      createSvgElement("path", {
        d: pathFromPoints(points),
        opacity: (0.18 + Math.abs(Math.sin(v)) * 0.28).toFixed(2)
      })
    );
  }

  svg.append(gridGroup);

  const travelerPoints = [];
  for (let step = 0; step <= 28; step += 1) {
    travelerPoints.push(torusPoint(3.65 + step * 0.05, Math.PI * 0.76));
  }

  svg.append(
    createSvgElement("path", {
      d: pathFromPoints(travelerPoints),
      class: "orbit-trace",
      stroke: "#0a0717",
      "stroke-width": "18",
      "stroke-linecap": "round",
      fill: "none",
      filter: "url(#soft-glow)"
    })
  );

  const magentaNode = torusPoint(3.55, Math.PI * 0.8);
  const cyanNode = torusPoint(0.15, Math.PI * 0.92);

  [magentaNode, cyanNode].forEach((point, index) => {
    const color = index === 0 ? "#f58cff" : "#73f7ff";
    const group = createSvgElement("g", {
      class: "node-pulse"
    });

    group.append(
      createSvgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: index === 0 ? "10" : "8",
        fill: color,
        opacity: "0.3",
        filter: "url(#soft-glow)"
      }),
      createSvgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: index === 0 ? "6.4" : "5.4",
        fill: color,
        stroke: "#130f34",
        "stroke-width": "2.2"
      })
    );

    svg.append(group);
  });

  const anchorAngles = [4.7, 5.25, 0.2, 0.88, 1.62, 2.6];
  anchorAngles.forEach((angle, index) => {
    const point = torusPoint(angle, 0.06);
    const dot = createSvgElement("circle", {
      cx: point.x,
      cy: point.y,
      r: index % 3 === 0 ? "5" : "3.2",
      fill: index % 3 === 0 ? "#0d0a24" : "#ffe08a",
      stroke: "#e7d59a",
      "stroke-width": "1.6",
      opacity: "0.88"
    });
    svg.append(dot);
  });
}

function buildSignals() {
  const signalField = document.getElementById("signal-field");

  if (!signalField) {
    return;
  }

  signalField.replaceChildren();

  const rows = [
    { color: "#ff678c", width: 92, nodes: [0.22, 0.67] },
    { color: "#ffa45c", width: 84, nodes: [0.36, 0.81] },
    { color: "#ffe08a", width: 78, nodes: [0.24, 0.7] },
    { color: "#66f0a4", width: 88, nodes: [0.33] },
    { color: "#73f7ff", width: 82, nodes: [0.49, 0.8] },
    { color: "#d189ff", width: 76, nodes: [0.58] }
  ];

  rows.forEach((row, index) => {
    const signalRow = document.createElement("div");
    signalRow.className = "signal-row";
    signalRow.style.color = row.color;

    const line = document.createElement("div");
    line.className = "signal-line";
    line.style.width = `${row.width}%`;
    line.style.left = `${index * 2}%`;

    signalRow.append(line);

    row.nodes.forEach((nodePosition, nodeIndex) => {
      const node = document.createElement("span");
      node.className = `signal-node ${nodeIndex === row.nodes.length - 1 && index < 2 ? "large" : ""}`.trim();
      node.style.left = `${nodePosition * row.width + index * 2}%`;
      signalRow.append(node);
    });

    signalField.append(signalRow);
  });
}

function buildFiberChart() {
  const svg = document.getElementById("fiber-chart");

  if (!svg) {
    return;
  }

  svg.replaceChildren();

  const width = 260;
  const height = 120;
  const left = 20;
  const right = width - 12;
  const bottom = height - 18;
  const top = 14;
  const pointsA = [22, 36, 44, 61, 88];
  const pointsB = [18, 28, 52, 56, 76];
  const pointsC = [15, 18, 26, 40, 58];

  function buildLine(values, color) {
    const step = (right - left) / (values.length - 1);
    const d = values
      .map((value, index) => {
        const x = left + step * index;
        const y = bottom - value;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

    svg.append(
      createSvgElement("path", {
        d,
        stroke: color,
        "stroke-width": "2.6",
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      })
    );
  }

  svg.append(
    createSvgElement("rect", {
      x: "6",
      y: "8",
      width: "248",
      height: "104",
      rx: "12",
      fill: "rgba(20, 17, 50, 0.4)",
      stroke: "rgba(149, 179, 255, 0.18)"
    })
  );

  svg.append(
    createSvgElement("line", {
      x1: left,
      y1: bottom,
      x2: right,
      y2: bottom,
      stroke: "rgba(255, 255, 255, 0.18)"
    }),
    createSvgElement("line", {
      x1: left,
      y1: bottom,
      x2: left,
      y2: top,
      stroke: "rgba(255, 255, 255, 0.18)"
    })
  );

  ["L1", "L2", "L3", "L4", "L5"].forEach((label, index) => {
    const x = left + ((right - left) / 4) * index;
    const text = createSvgElement("text", {
      x,
      y: height - 4,
      "text-anchor": "middle",
      fill: "#d9d2ef",
      "font-size": "10",
      "font-family": "Azeret Mono, monospace"
    });

    text.textContent = label;

    svg.append(
      createSvgElement("line", {
        x1: x,
        y1: bottom,
        x2: x,
        y2: top,
        stroke: "rgba(149, 179, 255, 0.12)"
      }),
      text
    );
  });

  buildLine(pointsA, "#ff678c");
  buildLine(pointsB, "#ffe08a");
  buildLine(pointsC, "#66f0a4");
}

function buildSettlementDots() {
  const container = document.getElementById("settlement-dots");

  if (!container) {
    return;
  }

  container.replaceChildren();

  const colors = ["#ff678c", "#ffa45c", "#ffe08a", "#73f7ff", "#66f0a4", "#d189ff"];

  for (let index = 0; index < 12; index += 1) {
    const dot = document.createElement("span");
    dot.className = "settlement-dot";
    dot.style.color = colors[index % colors.length];
    dot.style.background = colors[index % colors.length];
    container.append(dot);
  }
}

function buildBenchmarkBars() {
  const container = document.getElementById("benchmark-bars");

  if (!container) {
    return;
  }

  container.replaceChildren();

  const rows = [
    { label: "Settlement", promised: 12, delivered: 48, note: "600,000x" },
    { label: "Throughput", promised: 10, delivered: 62, note: "millisec." },
    { label: "Backing", promised: 16, delivered: 74, note: "silicon, not debt" },
    { label: "Gap", promised: 8, delivered: 86, note: "architecture" }
  ];

  rows.forEach((row) => {
    const wrapper = document.createElement("div");
    wrapper.className = "benchmark-row";

    const label = document.createElement("div");
    label.className = "benchmark-label";
    label.textContent = row.label;

    const track = document.createElement("div");
    track.className = "benchmark-track";

    const promised = document.createElement("div");
    promised.className = "benchmark-promised";
    promised.style.width = `${row.promised}%`;

    const delivered = document.createElement("div");
    delivered.className = "benchmark-delivered";
    delivered.style.width = `${row.delivered}%`;

    track.append(promised, delivered);

    const note = document.createElement("div");
    note.className = "benchmark-note";
    note.textContent = row.note;

    wrapper.append(label, track, note);
    container.append(wrapper);
  });
}

buildToroid();
buildSignals();
buildFiberChart();
buildSettlementDots();
buildBenchmarkBars();
