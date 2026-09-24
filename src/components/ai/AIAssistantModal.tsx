import React, { useState } from 'react';
import { db } from '../../services/db';
import { aiService, AIQueryResult, AISummaryResult } from '../../services/aiService';
import { Patient } from '../../types';
import {
  Bot,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  FileText
} from 'lucide-react';

export type AIMode = 'query' | 'summarizer' | 'safety' | 'all';

interface AIAssistantModalProps {
  onSelectPatient?: (patient: Patient) => void;
  initialMode?: AIMode;
}

export const AIAssistantModal: React.FC<AIAssistantModalProps> = ({ onSelectPatient, initialMode = 'all' }) => {
  const [queryInput, setQueryInput] = useState('');
  const [queryResult, setQueryResult] = useState<AIQueryResult | null>(null);
  
  // Patient summary section
  const patients = db.getPatients();
  const [selectedPatientId, setSelectedPatientId] = useState<string>(patients[0]?.id || '');
  const [summaryResult, setSummaryResult] = useState<AISummaryResult | null>(null);

  const sampleQueries = [
    'Show patients with HbA1c or diabetes pathology',
    'What were previous abnormal liver function results?',
    'Show outstanding laboratory results awaiting release',
    'Show low stock pharmacy medications'
  ];

  const handleRunQuery = (q: string) => {
    setQueryInput(q);
    const res = aiService.processNaturalLanguageQuery(q);
    setQueryResult(res);
  };

  const handleGenerateSummary = () => {
    const p = db.getPatientById(selectedPatientId);
    if (p) {
      const summary = aiService.summarizePatient(p);
      setSummaryResult(summary);
    }
  };

  const showQuery = initialMode === 'query' || initialMode === 'all';
  const showSummarizer = initialMode === 'summarizer' || initialMode === 'all';
  const showSafety = initialMode === 'safety';

  const modeTitle =
    initialMode === 'query' ? 'Natural Language Query' :
    initialMode === 'summarizer' ? 'Patient Summarizer' :
    initialMode === 'safety' ? 'Clinical AI Safeguards' :
    'Assistive Clinical AI & Natural Language Query Station';

  return (
    <div className="h-full flex flex-col select-text overflow-y-auto p-6 space-y-6">
      {/* Compact mode bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm flex-shrink-0">
        <div className="flex items-center space-x-2">
          <Bot className="w-4 h-4 text-fuchsia-600" />
          <span className="text-xs font-extrabold text-slate-900 dark:text-white">
            {modeTitle}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[10px] font-bold">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>AI-Assisted / Requires Clinical Review</span>
        </div>
      </div>

      {/* Grid: Query Box & Patient Summarizer */}
      <div className={`grid grid-cols-1 ${showQuery && showSummarizer ? 'lg:grid-cols-2' : ''} gap-6`}>

        {/* Module 1: Natural Language Clinical Query */}
        {showQuery && (
        <div className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
          <div className="flex items-center space-x-2 border-b border-light-border dark:border-dark-border pb-3">
            <Sparkles className="w-4 h-4 text-fuchsia-500" />
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
              1. Natural Language Clinical Query Box
            </h3>
          </div>

          <p className="text-xs text-slate-500">
            Ask questions in plain English. The AI translates your query into safe, read-only database inspections without destructive rights.
          </p>

          <div className="relative">
            <input
              type="text"
              placeholder="e.g. Show patients with HbA1c above 8% or abnormal liver results..."
              value={queryInput}
              onChange={e => setQueryInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && queryInput && handleRunQuery(queryInput)}
              className="w-full pl-4 pr-24 py-2.5 text-xs rounded-2xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
            />
            <button
              onClick={() => queryInput && handleRunQuery(queryInput)}
              className="absolute right-1.5 top-1.5 px-4 py-1.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-bold shadow-sm transition-all"
            >
              Ask AI
            </button>
          </div>

          {/* Quick Examples */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sample Queries:</span>
            <div className="flex flex-wrap gap-1.5">
              {sampleQueries.map((sq, idx) => (
                <button
                  key={idx}
                  onClick={() => handleRunQuery(sq)}
                  className="text-left px-2.5 py-1 rounded-lg text-[11px] bg-slate-100 dark:bg-dark-surface hover:bg-fuchsia-50 dark:hover:bg-fuchsia-950/40 text-slate-700 dark:text-slate-300 transition-all border border-transparent hover:border-fuchsia-300"
                >
                  "{sq}"
                </button>
              ))}
            </div>
          </div>

          {/* Query Results View */}
          {queryResult && (
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/50 border border-light-border dark:border-dark-border space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-fuchsia-600 dark:text-fuchsia-400 block">Interpretation:</span>
                  <div className="text-xs font-bold text-slate-800 dark:text-white">{queryResult.interpretation}</div>
                </div>
                <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/80 dark:text-fuchsia-300">
                  {queryResult.matchedCount} Result(s)
                </span>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2">
                {queryResult.data.map((item, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border text-xs">
                    <pre className="font-sans text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                      {JSON.stringify(item, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>

              <div className="text-[10px] text-slate-400 italic">
                {queryResult.disclaimer}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Module 2: AI Clinical Note Summarizer */}
        {showSummarizer && (
        <div className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
          <div className="flex items-center space-x-2 border-b border-light-border dark:border-dark-border pb-3">
            <FileText className="w-4 h-4 text-purple-500" />
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
              2. AI Comprehensive Patient Summarizer
            </h3>
          </div>

          <p className="text-xs text-slate-500">
            Synthesizes presenting complaints, history, prior diagnoses, abnormal laboratory parameters, and active prescriptions into a single concise clinician brief.
          </p>

          <div className="flex items-center space-x-3">
            <select
              value={selectedPatientId}
              onChange={e => setSelectedPatientId(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-dark-surface border border-light-border dark:border-dark-border text-xs font-bold"
            >
              {patients.map(p => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName} ({p.id}) - {p.sex}, {p.age}y
                </option>
              ))}
            </select>

            <button
              onClick={handleGenerateSummary}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-sm transition-all flex items-center space-x-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Summarize Patient</span>
            </button>
          </div>

          {/* Generated Summary Display */}
          {summaryResult && (
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-dark-surface/50 border border-purple-200 dark:border-purple-900/50 space-y-3 animate-in fade-in text-xs">
              <div className="flex items-center justify-between border-b border-light-border dark:border-dark-border pb-2">
                <span className="font-extrabold text-purple-700 dark:text-purple-300">
                  AI Synthesized Clinical Brief
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {new Date(summaryResult.generatedAt).toLocaleTimeString()}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border leading-relaxed text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
                {summaryResult.summaryText}
              </div>

              {/* Key Diagnoses */}
              {summaryResult.keyDiagnoses.length > 0 && (
                <div>
                  <strong className="text-slate-400 text-[10px] uppercase tracking-wider block mb-1">Diagnoses:</strong>
                  <div className="flex flex-wrap gap-1.5">
                    {summaryResult.keyDiagnoses.map((d, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 font-bold text-[10px]">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Abnormal Labs */}
              {summaryResult.abnormalLabs.length > 0 && (
                <div>
                  <strong className="text-rose-500 text-[10px] uppercase tracking-wider block mb-1">Abnormal Lab Flags:</strong>
                  <div className="space-y-1">
                    {summaryResult.abnormalLabs.map((lab, i) => (
                      <div key={i} className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 font-mono text-[10px]">
                        ⚠️ {lab}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[10px] text-slate-400 italic">
                {summaryResult.disclaimer}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Module 3: Clinical AI Safeguards */}
        {showSafety && (
        <div className="p-6 rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border shadow-sm space-y-4">
          <div className="flex items-center space-x-2 border-b border-light-border dark:border-dark-border pb-3">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
              Guardrails Enforced on Every AI Output
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {[
              { t: 'Read-only by design', d: 'The AI inspects records but can never create, edit or delete clinical data.' },
              { t: 'Clinician review required', d: 'Every query result and brief is labelled AI-assisted and must be verified before action.' },
              { t: 'No autonomous diagnosis', d: 'Outputs are suggestions and summaries — never final diagnoses or prescriptions.' },
              { t: 'Role-gated actions', d: 'Result entry, dispensing and payments stay restricted to authorized roles regardless of AI output.' },
              { t: 'Fully audited', d: `${db.getAuditLogs().length} audit events recorded — every AI-assisted step is traceable.` },
              { t: 'Critical results stay human', d: 'Critical lab flags always route to the scientist and physician workflow, never auto-cleared.' },
            ].map(g => (
              <div key={g.t} className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50">
                <div className="font-extrabold text-emerald-800 dark:text-emerald-200 flex items-center space-x-1.5">
                  <CheckCircle2 className="w-4 h-4" /><span>{g.t}</span>
                </div>
                <p className="text-slate-600 dark:text-slate-300 mt-1">{g.d}</p>
              </div>
            ))}
          </div>
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-700 dark:text-amber-300 flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>If an AI suggestion ever conflicts with clinical judgement, clinical judgement wins — and the disagreement should be documented in the consultation notes.</span>
          </div>
        </div>
        )}

      </div>
    </div>
  );
};
