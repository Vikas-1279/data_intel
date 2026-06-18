import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

console.log("Starting server.ts initialization...");

const app = express();
const PORT = 3000;

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// In-memory storage for multiple datasets
let datasets: Record<string, { data: any[], schema: any, info: any }> = {};

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.get("/api/health", (req, res) => {
  console.log("Health check requested");
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/datasets", (req, res) => {
  console.log("Datasets list request received");
  const list = Object.values(datasets).map(d => d.info);
  res.json(list);
});

app.get("/api/dataset/:id", (req, res) => {
  const id = req.params.id;
  console.log("Dataset request received for:", id);
  const dataset = datasets[id];
  if (!dataset) return res.status(404).json({ error: "Dataset not found" });
  res.json({ data: dataset.data, schema: dataset.schema });
});

app.delete("/api/dataset/:id", (req, res) => {
  const id = req.params.id;
  console.log("Delete request received for:", id);
  if (!datasets[id]) return res.status(404).json({ error: "Dataset not found" });
  delete datasets[id];
  res.json({ status: "ok", message: `Dataset ${id} deleted` });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  console.log("Upload request received at /api/upload");
  
  if (!req.file) {
    console.log("No file uploaded in request");
    return res.status(400).json({ error: "No file uploaded" });
  }

  console.log("Processing file:", req.file.originalname, "Size:", req.file.size);
  const extension = path.extname(req.file.originalname).toLowerCase();

  try {
    let data: any[] = [];
    if (extension === ".csv") {
      const fileContent = req.file.buffer.toString("utf8");
      const result = Papa.parse(fileContent, { header: true, dynamicTyping: true, skipEmptyLines: true });
      data = result.data;
    } else if (extension === ".xlsx" || extension === ".xls") {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet);
    } else {
      console.log("Unsupported extension:", extension);
      return res.status(400).json({ error: "Unsupported file format" });
    }

      // Clean up empty rows
      data = data.filter(row => Object.values(row).some(val => val !== null && val !== undefined && val !== ""));

      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      const dtypes: Record<string, string> = {};
      if (data.length > 0) {
        columns.forEach(col => {
          const val = data[0][col];
          dtypes[col] = typeof val;
        });
      }

      const id = req.file.originalname;
      const info = {
        id,
        fileName: req.file.originalname,
        columns,
        dtypes,
        preview: data.slice(0, 5),
        totalRows: data.length
      };

      // Update in-memory storage
      datasets[id] = {
        data,
        schema: { columns, dtypes },
        info
      };

      console.log("Successfully processed", data.length, "rows");
      res.json(info);
    } catch (error: any) {
      console.error("Processing error:", error);
      res.status(500).json({ error: "Failed to process file", details: error.message });
    }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === "production";
  const distPath = path.join(process.cwd(), "dist");
  const hasDist = fs.existsSync(distPath);

  console.log(`Starting server (mode: ${process.env.NODE_ENV}, hasDist: ${hasDist})`);

  if (!isProd || !hasDist) {
    console.log("Using Vite middleware");
    const vite = await createViteServer({
      configFile: false,
      root: process.cwd(),
      plugins: [react(), tailwindcss()],
      define: {
        'process.env.GEMINI_API_KEY': JSON.stringify(process.env.GEMINI_API_KEY || ""),
      },
      resolve: {
        alias: {
          '@': path.resolve(process.cwd(), '.'),
        },
      },
      build: {
        chunkSizeWarningLimit: 2000,
      },
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving static files from dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
