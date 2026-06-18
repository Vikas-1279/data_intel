import React, { useState, useRef, useEffect } from "react";
import { 
  Upload, 
  MessageSquare, 
  BarChart3, 
  Table as TableIcon,
  Info,
  Send,
  FileText,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Database,
  Download,
  Trash2
} from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { motion, AnimatePresence } from "motion/react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  Legend
} from "recharts";
import { GoogleGenAI } from "@google/genai";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface DatasetInfo {
  id: string;
  fileName: string;
  columns: string[];
  dtypes: Record<string, string>;
  preview: any[];
  totalRows: number;
}

interface Message {
  role: "user" | "ai";
  content: string;
  timestamp: Date;
  output?: AnalysisOutput;
}

interface AnalysisOutput {
  type: "chart" | "table" | "text";
  data?: any[];
  chartConfig?: any;
  keyPoints: string[];
  error?: string;
}

// --- App Component ---
export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const loadingMessages = ["Analyzing data...", "Generating insights..."];
  const [activeOutput, setActiveOutput] = useState<AnalysisOutput | null>(null);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dataset = datasets.find(d => d.id === selectedDatasetId) || null;

  useEffect(() => {
    let interval: any;
    if (isAnalyzing) {
      setLoadingStep(0);
      interval = setInterval(() => {
        setLoadingStep(prev => (prev + 1) % loadingMessages.length);
      }, 2000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isAnalyzing]);

  const downloadCSV = (data: any[], filename: string) => {
    if (!data || data.length === 0) return;
    
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(header => {
        const cell = row[header] === null || row[header] === undefined ? '' : String(row[header]);
        return `"${cell.replace(/"/g, '""')}"`;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDeleteDataset = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDatasets(prev => {
      const filtered = prev.filter(d => d.id !== id);
      if (selectedDatasetId === id) {
        setSelectedDatasetId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
  };

  useEffect(() => {
    // Initial datasets can be left empty
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setIsUploading(true);

    try {
      const extension = selectedFile.name.split('.').pop()?.toLowerCase();
      let data: any[] = [];

      if (extension === 'csv') {
        data = await new Promise<any[]>((resolve, reject) => {
          Papa.parse(selectedFile, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => resolve(results.data),
            error: (error) => reject(error)
          });
        });
      } else if (extension === 'xlsx' || extension === 'xls') {
        const buffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        data = XLSX.utils.sheet_to_json(worksheet);
      } else {
        throw new Error("Unsupported file format");
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

      const id = selectedFile.name;
      const datasetInfo: DatasetInfo = {
        id,
        fileName: selectedFile.name,
        columns,
        dtypes,
        preview: data.slice(0, 5),
        totalRows: data.length
      };

      setDatasets(prev => [...prev, datasetInfo]);
      setSelectedDatasetId(id);
      setMessages(prev => [...prev, {
        role: "ai",
        content: `I've loaded **${selectedFile.name}**. I see ${columns.length} columns and ${data.length} rows. What would you like to know about this data?`,
        timestamp: new Date()
      }]);
    } catch (error) {
      console.error("Upload error:", error);
      setMessages(prev => [...prev, {
        role: "ai",
        content: "Sorry, I couldn't process that file. Please make sure it's a valid CSV or Excel file.",
        timestamp: new Date()
      }]);
    } finally {
      setIsUploading(false);
      // Reset input value so same file can be uploaded again if needed
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !dataset || isAnalyzing) return;

    const userMessage: Message = {
      role: "user",
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsAnalyzing(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const model = ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [{
              text: `You are a professional data analyst.
              
              Dataset Info:
              File: ${dataset.fileName}
              Columns: ${dataset.columns.join(", ")}
              Data Types: ${JSON.stringify(dataset.dtypes)}
              Preview Data: ${JSON.stringify(dataset.preview)}
              
              User Question: "${input}"
              
              Analyze the data and return a JSON response with the following structure:
              {
                "type": "chart" | "table" | "text",
                "data": [array of objects for table or chart],
                "chartConfig": {
                  "xAxis": "column_name_for_x_axis",
                  "yAxis": "column_name_for_y_axis",
                  "title": "Chart Title"
                },
                "keyPoints": ["Point 1", "Point 2", "Point 3"],
                "answer": "A brief text answer to the question"
              }
              
              Rules:
              - If the question asks for a comparison, trend, or distribution, use "chart".
              - If the question asks for a list or raw data, use "table".
              - If it's a simple calculation, use "text".
              - Currency: Default to USD ($) for all monetary values. Use INR (₹) ONLY if the dataset is clearly Indian (e.g., contains Indian cities, "CarDekho", "Zomato", etc.) or if the user explicitly asks for it.
              - For charts, we use Recharts BarChart. "data" should be an array of objects where each object has keys corresponding to xAxis and yAxis.
              - "keyPoints" should be a list of 3-4 concise analytical observations.
              - Ensure the "data" field contains the processed results.
              - If you cannot answer the question with the given columns, return an error message in the "answer" field.
              - ONLY return valid JSON. No markdown formatting.`
            }]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const result = await model;
      const responseText = result.text;
      const analysis: AnalysisOutput & { answer: string } = JSON.parse(responseText || "{}");

      const aiMessage: Message = {
        role: "ai",
        content: analysis.answer || "Here is what I found:",
        timestamp: new Date(),
        output: analysis
      };

      setMessages(prev => [...prev, aiMessage]);
      setActiveOutput(analysis);
    } catch (error: any) {
      console.error("Analysis error:", error);
      setMessages(prev => [...prev, {
        role: "ai",
        content: `An error occurred during analysis: ${error?.message || "Unknown error"}. Please check your API key and connection.`,
        timestamp: new Date()
      }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const loadSampleData = () => {
    const sampleData = [
      { month: "Jan", sales: 4000, profit: 2400 },
      { month: "Feb", sales: 3000, profit: 1398 },
      { month: "Mar", sales: 2000, profit: 9800 },
      { month: "Apr", sales: 2780, profit: 3908 },
      { month: "May", sales: 1890, profit: 4800 },
      { month: "Jun", sales: 2390, profit: 3800 },
      { month: "Jul", sales: 3490, profit: 4300 },
    ];
    
    const sampleDataset: DatasetInfo = {
      id: "Sample Sales Data.csv",
      fileName: "Sample Sales Data.csv",
      columns: ["month", "sales", "profit"],
      dtypes: { month: "string", sales: "number", profit: "number" },
      preview: sampleData.slice(0, 5),
      totalRows: sampleData.length
    };

    setDatasets(prev => [...prev, sampleDataset]);
    setSelectedDatasetId(sampleDataset.id);
    setMessages(prev => [...prev, {
      role: "ai",
      content: "I've loaded some **Sample Sales Data**. You can ask me to visualize sales by month or compare sales and profit (in USD $).",
      timestamp: new Date()
    }]);
  };

  return (
    <div className="flex h-screen w-full bg-[#FAFAFA] text-[#1A1A1A] font-sans overflow-hidden">
      {/* --- LEFT PANEL: Sidebar --- */}
      <aside className="w-[20%] border-r border-[#E5E5E5] bg-white flex flex-col p-6 overflow-y-auto">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <Database className="text-white w-5 h-5" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">Data Intel</h1>
        </div>

        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#737373]">Datasets</h2>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="text-[10px] font-bold text-black hover:underline"
              >
                + ADD NEW
              </button>
            </div>
            
            <div className="space-y-2">
              {datasets.map((d) => (
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedDatasetId(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setSelectedDatasetId(d.id);
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-2xl border transition-all text-left group relative cursor-pointer outline-none",
                    selectedDatasetId === d.id 
                      ? "bg-black text-white border-black shadow-md" 
                      : "bg-white text-black border-[#E5E5E5] hover:border-black"
                  )}
                >
                  <FileText className={cn("w-4 h-4", selectedDatasetId === d.id ? "text-white" : "text-black")} />
                  <div className="overflow-hidden flex-1">
                    <p className="text-xs font-semibold truncate pr-6">{d.fileName}</p>
                    <p className={cn("text-[9px]", selectedDatasetId === d.id ? "text-white/60" : "text-[#737373]")}>
                      {d.totalRows} rows
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDeleteDataset(e, d.id)}
                    className={cn(
                      "absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity",
                      selectedDatasetId === d.id ? "hover:bg-white/20 text-white" : "hover:bg-red-50 text-red-500"
                    )}
                    title="Delete dataset"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {datasets.length === 0 && (
                <div className="space-y-3">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="w-full border-2 border-dashed border-[#E5E5E5] rounded-2xl p-8 flex flex-col items-center justify-center gap-3 hover:border-black transition-colors group"
                  >
                    {isUploading ? (
                      <Loader2 className="w-6 h-6 animate-spin text-[#737373]" />
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-[#A3A3A3] group-hover:text-black transition-colors" />
                        <span className="text-sm font-medium text-[#737373] group-hover:text-black">Upload CSV/XLSX</span>
                      </>
                    )}
                  </button>
                  <button 
                    onClick={loadSampleData}
                    className="w-full py-2 px-4 bg-[#F5F5F5] border border-[#E5E5E5] rounded-xl text-xs font-semibold hover:bg-black hover:text-white transition-all"
                  >
                    Try Sample Data
                  </button>
                </div>
              )}
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept=".csv,.xlsx,.xls" 
              className="hidden" 
            />
          </section>

          {dataset && (
            <motion.section 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-2">Columns</h3>
                <div className="flex flex-wrap gap-1.5">
                  {dataset.columns.map(col => (
                    <span key={col} className="px-2 py-1 bg-white border border-[#E5E5E5] rounded-lg text-[10px] font-medium">
                      {col}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-2">Preview</h3>
                <div className="bg-white border border-[#E5E5E5] rounded-xl overflow-hidden">
                  <div className="max-h-40 overflow-auto">
                    <table className="w-full text-[10px] text-left border-collapse">
                      <thead className="bg-[#F5F5F5] sticky top-0">
                        <tr>
                          {dataset.columns.slice(0, 3).map(col => (
                            <th key={col} className="p-2 border-b border-[#E5E5E5] font-semibold">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataset.preview.map((row, i) => (
                          <tr key={i} className="hover:bg-[#FAFAFA]">
                            {dataset.columns.slice(0, 3).map(col => (
                              <td key={col} className="p-2 border-b border-[#F5F5F5] truncate max-w-[80px]">{String(row[col])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </div>
      </aside>

      {/* --- CENTER PANEL: Chat --- */}
      <main className="w-[40%] flex flex-col bg-white border-r border-[#E5E5E5]">
        <header className="p-6 border-b border-[#E5E5E5] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#737373]" />
            <h2 className="text-sm font-semibold">Conversation</h2>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-8">
              <div className="w-12 h-12 bg-[#F5F5F5] rounded-2xl flex items-center justify-center mb-4">
                <MessageSquare className="w-6 h-6 text-[#A3A3A3]" />
              </div>
              <p className="text-sm font-medium text-[#737373]">
                {dataset ? "Ask a question about your data" : "Upload a file to start analyzing"}
              </p>
            </div>
          )}
          
          {messages.map((msg, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex flex-col max-w-[85%]",
                msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
              )}
            >
              <div className={cn(
                "p-4 rounded-2xl text-sm leading-relaxed shadow-sm",
                msg.role === "user" 
                  ? "bg-black text-white rounded-tr-none" 
                  : "bg-[#F5F5F5] text-[#1A1A1A] rounded-tl-none border border-[#E5E5E5]"
              )}>
                {msg.content}
              </div>
              <span className="text-[10px] text-[#A3A3A3] mt-1 px-1">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              
              {msg.output && (
                <button 
                  onClick={() => setActiveOutput(msg.output!)}
                  className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-black hover:underline"
                >
                  View Analysis <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </motion.div>
          ))}

          {isAnalyzing && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-start max-w-[85%] mr-auto"
            >
              <div className="p-4 rounded-2xl text-sm leading-relaxed shadow-sm bg-[#F5F5F5] text-[#1A1A1A] rounded-tl-none border border-[#E5E5E5] flex items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-black" />
                <AnimatePresence mode="wait">
                  <motion.span
                    key={loadingStep}
                    initial={{ opacity: 0, x: 5 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -5 }}
                    transition={{ duration: 0.3 }}
                  >
                    {loadingMessages[loadingStep]}
                  </motion.span>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-6 border-t border-[#E5E5E5]">
          <div className="relative flex items-center">
            <input 
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder={dataset ? "Ask anything..." : "Upload a file first"}
              disabled={!dataset || isAnalyzing}
              className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-2xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-black transition-colors disabled:opacity-50"
            />
            <button 
              onClick={handleSendMessage}
              disabled={!dataset || isAnalyzing || !input.trim()}
              className="absolute right-2 p-2 bg-black text-white rounded-xl hover:opacity-80 transition-opacity disabled:opacity-30"
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </main>

      {/* --- RIGHT PANEL: Output --- */}
      <section className="w-[40%] flex flex-col bg-[#FAFAFA] p-6 overflow-y-auto">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#737373]" />
            <h2 className="text-sm font-semibold">Analysis Output</h2>
          </div>
          {activeOutput && (
            <div className="flex gap-2">
              <span className={cn(
                "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                activeOutput.type === "chart" ? "bg-black text-white" : "bg-white text-black border border-[#E5E5E5]"
              )}>
                {activeOutput.type}
              </span>
            </div>
          )}
        </header>

        <AnimatePresence mode="wait">
          {!activeOutput ? (
            <motion.div 
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center text-center text-[#A3A3A3]"
            >
              <div className="w-16 h-16 bg-white border border-[#E5E5E5] rounded-3xl flex items-center justify-center mb-4 shadow-sm">
                <BarChart3 className="w-8 h-8" />
              </div>
              <p className="text-sm font-medium">Visualizations and key points will appear here</p>
            </motion.div>
          ) : (
            <motion.div 
              key="content"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6 pb-12"
            >
              {/* Main Analysis Content */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Visualization Column */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white rounded-3xl p-6 border border-[#E5E5E5] shadow-sm min-h-[400px] flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-sm font-bold">{activeOutput.chartConfig?.title || "Visualization"}</h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => downloadCSV(activeOutput.data || [], 'analysis_data')}
                          className="flex items-center gap-1.5 px-2 py-1 bg-white hover:bg-[#F5F5F5] text-[#737373] rounded-lg border border-[#E5E5E5] transition-colors text-[10px] font-bold uppercase tracking-wider"
                          title="Download Data as CSV"
                        >
                          <Download className="w-3 h-3" />
                          Export
                        </button>
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-[#F5F5F5] rounded-lg border border-[#E5E5E5]">
                          <BarChart3 className="w-3 h-3 text-[#737373]" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#737373]">{activeOutput.type}</span>
                        </div>
                      </div>
                    </div>

                    {activeOutput.type === "chart" && activeOutput.chartConfig && (
                      <div className="flex-1 w-full h-full min-h-[300px]">
                        <ResponsiveContainer width="100%" height={350}>
                          <BarChart
                            data={activeOutput.data}
                            margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                            <XAxis 
                              dataKey={activeOutput.chartConfig.xAxis} 
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: '#737373', fontSize: 10 }}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis 
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: '#737373', fontSize: 10 }}
                            />
                            <Tooltip 
                              cursor={{ fill: '#f5f5f5' }}
                              contentStyle={{ 
                                borderRadius: '12px', 
                                border: '1px solid #E5E5E5',
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                fontSize: '12px'
                              }}
                            />
                            <Legend verticalAlign="top" height={36}/>
                            <Bar 
                              dataKey={activeOutput.chartConfig.yAxis} 
                              fill="#000000" 
                              radius={[4, 4, 0, 0]} 
                              barSize={40}
                            >
                              {activeOutput.data?.map((entry: any, index: number) => (
                                <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#000000' : '#404040'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {activeOutput.type === "table" && activeOutput.data && (
                      <div className="flex-1 overflow-auto rounded-xl border border-[#F5F5F5]">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead className="bg-[#F5F5F5] sticky top-0">
                            <tr>
                              {Object.keys(activeOutput.data[0] || {}).map(key => (
                                <th key={key} className="p-3 border-b border-[#E5E5E5] font-semibold">{key}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {activeOutput.data.map((row, i) => (
                              <tr key={i} className="hover:bg-[#FAFAFA]">
                                {Object.values(row).map((val: any, j) => (
                                  <td key={j} className="p-3 border-b border-[#F5F5F5]">{String(val)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {activeOutput.type === "text" && (
                      <div className="flex-1 flex items-center justify-center p-8 text-center">
                        <p className="text-2xl font-bold tracking-tight leading-tight">
                          {Array.isArray(activeOutput.keyPoints) ? activeOutput.keyPoints[0] : activeOutput.keyPoints}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Insights Column */}
                <div className="space-y-6">
                  <div className="bg-white rounded-3xl p-6 border border-[#E5E5E5] shadow-sm h-full">
                    <div className="flex items-center gap-2 text-[#737373] mb-6">
                      <Info className="w-4 h-4" />
                      <h3 className="text-xs font-bold uppercase tracking-wider">Key points</h3>
                    </div>
                    
                    <div className="space-y-4">
                      {activeOutput.keyPoints && Array.isArray(activeOutput.keyPoints) ? (
                        activeOutput.keyPoints.map((point, idx) => (
                          <div key={idx} className="flex gap-3">
                            <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-black shrink-0" />
                            <p className="text-xs leading-relaxed text-[#404040]">{point}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs leading-relaxed text-[#404040]">{activeOutput.keyPoints}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Detailed Preview Area */}
              {activeOutput.data && activeOutput.type !== "table" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[#737373]">
                    <TableIcon className="w-4 h-4" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Raw Data Context</h3>
                  </div>
                  <div className="bg-white rounded-2xl overflow-hidden border border-[#E5E5E5] shadow-sm">
                    <div className="max-h-[300px] overflow-auto">
                      <table className="w-full text-[11px] text-left border-collapse">
                        <thead className="bg-[#F5F5F5] sticky top-0">
                          <tr>
                            {Object.keys(activeOutput.data[0] || {}).map(key => (
                              <th key={key} className="p-2.5 border-b border-[#E5E5E5] font-semibold text-[#737373]">{key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeOutput.data.slice(0, 10).map((row, i) => (
                            <tr key={i} className="hover:bg-[#FAFAFA]">
                              {Object.values(row).map((val: any, j) => (
                                <td key={j} className="p-2.5 border-b border-[#F5F5F5] text-[#404040]">{String(val)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {activeOutput.data.length > 10 && (
                      <div className="p-2.5 bg-[#F5F5F5] text-center text-[10px] text-[#737373] font-medium uppercase tracking-wider">
                        Showing first 10 rows of {activeOutput.data.length}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

