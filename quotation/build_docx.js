const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  BorderStyle, AlignmentType, LevelFormat, Header, Footer, PageNumber, PositionalTab,
  PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader, VerticalAlign, TableLayoutType,
} = require("docx");

const NAVY = "111C3D", BLUE = "2A73F0", LINE = "D6E2F5", PALE = "EAF2FE", GREY = "5B6B8C", TEXT = "1A1F36";
const FONT = "Arial";
const W = 9752; // A4 content width in DXA with 1077 margins
const HALF = (W - 120) / 2; // gap column between module boxes

const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: none, bottom: none, left: none, right: none };
const thin = { style: BorderStyle.SINGLE, size: 6, color: LINE };
const boxBorders = { top: thin, bottom: thin, left: thin, right: thin };

const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || 16, bold: o.bold, color: o.color || TEXT });
const para = (children, o = {}) => new Paragraph({ children: [].concat(children), spacing: { before: o.before || 0, after: o.after || 0, line: o.line }, alignment: o.align, keepNext: o.keepNext });
const bullet = (text, o = {}) => new Paragraph({ numbering: { reference: "dots", level: 0 }, children: [run(text, { size: o.size || 16 })], spacing: { after: o.after || 70, line: 264 } });

// ---------- modules (features taken from the SaleStorm CRM) ----------
const modules = JSON.parse(fs.readFileSync(__dirname + "/modules.json", "utf8"));

const boxCell = ([title, items]) => new TableCell({
  width: { size: HALF, type: WidthType.DXA }, borders: boxBorders,
  margins: { top: 150, bottom: 80, left: 160, right: 160 },
  children: [para(run(title, { size: 19, bold: true, color: NAVY }), { after: 110 }), ...items.map(t => bullet(t))],
});
const gapCell = () => new TableCell({ width: { size: 120, type: WidthType.DXA }, borders: noBorders, children: [para(run(""))] });
const emptyCell = () => new TableCell({ width: { size: HALF, type: WidthType.DXA }, borders: noBorders, children: [para(run(""))] });

// one table per pair, so Word keeps each pair of boxes together and they can break between pairs
const moduleTables = [];
for (let i = 0; i < modules.length; i += 2) {
  moduleTables.push(new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [HALF, 120, HALF], layout: TableLayoutType.FIXED,
    rows: [new TableRow({ cantSplit: true, children: [boxCell(modules[i]), gapCell(), modules[i + 1] ? boxCell(modules[i + 1]) : emptyCell()] })],
  }));
  moduleTables.push(para(run(""), { after: 0, line: 160 }));
}

// ---------- banner and price block ----------
const fill = (color) => ({ type: ShadingType.CLEAR, color: "auto", fill: color });
const banner = new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [5552, 4200], layout: TableLayoutType.FIXED,
  rows: [new TableRow({ children: [
    new TableCell({ width: { size: 5552, type: WidthType.DXA }, shading: fill(NAVY), borders: noBorders, margins: { top: 220, bottom: 160, left: 280, right: 120 },
      children: [para(run("ZEPLOY TECH", { size: 38, bold: true, color: "FFFFFF" }), { after: 200 }), para(run("WE DEPLOY YOUR VISION", { size: 16, color: "FFFFFF" }))] }),
    new TableCell({ width: { size: 4200, type: WidthType.DXA }, shading: fill(NAVY), borders: noBorders, margins: { top: 260, bottom: 160, left: 120, right: 200 },
      children: [para(run("CUSTOM SOFTWARE DEVELOPMENT", { size: 16, color: "FFFFFF" }), { after: 380 }), para(run("REAL ESTATE CRM", { size: 16, color: "FFFFFF" }))] }),
  ] })],
});

const white = { style: BorderStyle.SINGLE, size: 6, color: "7FA9F5" };
const price = new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [5800, 3952], layout: TableLayoutType.FIXED,
  rows: [new TableRow({ children: [
    new TableCell({ width: { size: 5800, type: WidthType.DXA }, shading: fill(BLUE), borders: { ...noBorders, right: white }, margins: { top: 220, bottom: 240, left: 320, right: 200 },
      children: [para(run("ONE-TIME DEVELOPMENT CHARGES", { size: 15, bold: true, color: "FFFFFF" }), { after: 340 }), para(run("PKR 175,000", { size: 46, bold: true, color: "FFFFFF" }))] }),
    new TableCell({ width: { size: 3952, type: WidthType.DXA }, shading: fill(BLUE), borders: noBorders, margins: { top: 220, bottom: 200, left: 280, right: 200 },
      children: [para(run("SCOPE", { size: 15, bold: true, color: "FFFFFF" }), { after: 380 }),
        ...["Up to 10 users", "Custom development", "Client ownership after final payment"].map(t => para(run(t, { size: 15, color: "FFFFFF" }), { after: 30 }))] }),
  ] })],
});

// ---------- commercial terms ----------
const terms = [
  ["Development fee", "PKR 175,000 one-time"], ["Users", "Up to 10 users"], ["Version 1 presentation", "10 November 2026"],
  ["Payment 1", "50% upfront to start the project: PKR 87,500"], ["Payment 2", "50% upon completion of Version 1: PKR 87,500"],
  ["Maintenance", "No maintenance charges included"], ["Ownership", "Complete system and source code ownership transfers to the client after final payment"],
];
const termsTable = new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [3060, 6692], layout: TableLayoutType.FIXED,
  rows: terms.map(([k, v]) => new TableRow({ cantSplit: true, children: [
    new TableCell({ width: { size: 3060, type: WidthType.DXA }, shading: fill(PALE), borders: boxBorders, margins: { top: 130, bottom: 130, left: 170, right: 120 }, verticalAlign: VerticalAlign.CENTER, children: [para(run(k, { bold: true }))] }),
    new TableCell({ width: { size: 6692, type: WidthType.DXA }, borders: boxBorders, margins: { top: 130, bottom: 130, left: 170, right: 120 }, verticalAlign: VerticalAlign.CENTER, children: [para(run(v))] }),
  ] })),
});

const exclusions = [
  "Domain, hosting and server costs will be arranged and paid directly by the client.",
  "All third-party API or service charges, including WhatsApp, SMS, email, maps and similar services, will be paid by the client.",
  "This quotation covers development charges only. Hosting, domain, server, third-party usage fees and maintenance are not included.",
  "Accounts & Finance is an additional requested module included in this quoted scope. Advanced accounting, tax filing, bank integrations, payment gateway integrations, automated commissions, and other financial workflows are not included unless expressly listed.",
  "Any additional feature, integration, customization or change beyond the modules and features listed in this quotation will be reviewed and quoted separately before work begins.",
];

const signCell = (head, lines) => [head, lines];
const SW = W / 2;
const signTable = new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [SW, SW], layout: TableLayoutType.FIXED,
  rows: [
    new TableRow({ cantSplit: true, children: ["CLIENT APPROVAL", "ZEPLOY TECH"].map(h => new TableCell({ width: { size: SW, type: WidthType.DXA }, shading: fill(PALE), borders: boxBorders, margins: { top: 170, bottom: 170, left: 170, right: 120 }, children: [para(run(h, { bold: true, color: NAVY }))] })) }),
    new TableRow({ cantSplit: true, children: [
      ["Name: ___________________________", "Signature: ________________________", "Date: ____________________________"],
      ["Authorized representative: __________________", "Signature: _______________________________", "Date: ___________________________________"],
    ].map(lines => new TableCell({ width: { size: SW, type: WidthType.DXA }, borders: boxBorders, margins: { top: 200, bottom: 120, left: 170, right: 120 }, children: lines.map(l => para(run(l), { after: 200 })) })) }),
  ],
});

const h = (text, size, before, after) => para(run(text, { size, bold: true, color: NAVY }), { before, after, keepNext: true });

// ---------- header / footer ----------
const rule = { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 6 } };
const header = new Header({ children: [new Paragraph({ border: rule, children: [
  run("ZEPLOY TECH", { size: 17, bold: true, color: NAVY }),
  new TextRun({ children: [new PositionalTab({ alignment: PositionalTabAlignment.RIGHT, relativeTo: PositionalTabRelativeTo.MARGIN, leader: PositionalTabLeader.NONE }), "REAL ESTATE CRM | QUOTATION"], font: FONT, size: 17, color: GREY }),
] })] });
const firstHeader = new Header({ children: [para(run(""))] });
const footer = new Footer({ children: [new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 6 } }, children: [
  run("We Deploy Your Vision", { size: 15, color: GREY }),
  new TextRun({ children: [new PositionalTab({ alignment: PositionalTabAlignment.RIGHT, relativeTo: PositionalTabRelativeTo.MARGIN, leader: PositionalTabLeader.NONE }), "Page ", PageNumber.CURRENT], font: FONT, size: 15, color: GREY }),
] })] });

const doc = new Document({
  creator: "Zeploy Tech", title: "Zeploy Tech Real Estate CRM Quotation",
  styles: { default: { document: { run: { font: FONT, size: 16, color: TEXT } } } },
  numbering: { config: [{ reference: "dots", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 200, hanging: 200 } }, run: { color: BLUE } } }] }] },
  sections: [{
    properties: { titlePage: true, page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, bottom: 1000, left: 1077, right: 1077, header: 560, footer: 500 } } },
    headers: { default: header, first: firstHeader },
    footers: { default: footer, first: footer },
    children: [
      banner,
      h("QUOTATION", 24, 300, 120),
      h("Custom Real Estate CRM Development", 26, 120, 120),
      para(run("Custom CRM development for up to 10 users, based on the agreed module list."), { after: 220 }),
      price,
      h("Modules & Features Included", 26, 300, 120),
      para(run("The following modules and feature names define the quoted Version 1 scope. Any item not listed here is outside the agreed scope unless approved separately."), { after: 200, line: 264 }),
      ...moduleTables,
      new Paragraph({ pageBreakBefore: true, keepNext: true, spacing: { before: 120, after: 160 }, children: [run("Commercial Terms", { size: 26, bold: true, color: NAVY })] }),
      termsTable,
      h("Client-Paid Costs & Exclusions", 26, 360, 160),
      ...exclusions.map(t => bullet(t, { after: 120 })),
      para(run(""), { after: 120 }),
      signTable,
      para(run("This quotation is subject to written approval of the scope above. Work on any additional requirement will begin only after a separate quotation and approval.", { size: 14, color: GREY }), { before: 160, line: 264 }),
    ],
  }],
});

Packer.toBuffer(doc).then(b => { fs.writeFileSync(process.argv[2], b); console.log("written", b.length); });
