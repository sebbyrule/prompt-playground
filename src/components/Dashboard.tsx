import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import api from '../utils/api';
import { 
  FolderGit2, 
  FileCode2, 
  Play, 
  TrendingUp, 
  Clock, 
  Trash2
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip,
  BarChart,
  Bar
} from 'recharts';

interface RunLog {
  id: string;
  timestamp: string;
  projectName?: string;
  promptName?: string;
  model: string;
  metrics: {
    durationMs: number;
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
  passed?: boolean;
}

export const Dashboard: React.FC = () => {
  const [projectsCount, setProjectsCount] = useState(0);
  const [promptsCount, setPromptsCount] = useState(0);
  const [recentRuns, setRecentRuns] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const projects = await api.get('/api/projects');
        setProjectsCount(projects.length);
        
        let pCount = 0;
        projects.forEach((p: any) => {
          pCount += p.prompts?.length || 0;
        });
        setPromptsCount(pCount);

        const runs = await api.get('/api/runs');
        setRecentRuns(runs);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const handleClearHistory = async () => {
    if (window.confirm('Clear all run history?')) {
      try {
        await api.delete('/api/runs');
        setRecentRuns([]);
      } catch (e) {
        console.error(e);
      }
    }
  };

  // Process data for charts
  const latencyData = recentRuns
    .slice(0, 15)
    .reverse()
    .map((run, index) => ({
      name: `Run ${index + 1}`,
      latency: Math.round(run.metrics.durationMs / 10) / 100, // seconds
      tokens: run.metrics.tokenUsage.totalTokens
    }));

  const modelCounts = recentRuns.reduce((acc: { [key: string]: number }, run) => {
    const shortModelName = run.model.split('/').pop() || run.model;
    acc[shortModelName] = (acc[shortModelName] || 0) + 1;
    return acc;
  }, {});

  const modelChartData = Object.entries(modelCounts).map(([model, count]) => ({
    model,
    count
  }));

  const avgLatency = recentRuns.length
    ? Math.round(recentRuns.reduce((sum, run) => sum + run.metrics.durationMs, 0) / recentRuns.length)
    : 0;

  const totalTokensUsed = recentRuns.reduce((sum, run) => sum + (run.metrics.tokenUsage.totalTokens || 0), 0);

  if (loading) {
    return <div className="dashboard-loading">Loading Dashboard...</div>;
  }

  return (
    <div className="dashboard-container fade-in">
      <div className="dashboard-header">
        <h1>Workspace Dashboard</h1>
        <p>Overview of your local AI prompt experiments, metrics, and logs.</p>
      </div>

      {/* Grid Stats */}
      <div className="stats-grid">
        <div className="stat-card glass-panel">
          <div className="stat-icon-wrapper">
            <FolderGit2 className="stat-icon" size={22} />
          </div>
          <div className="stat-data">
            <span className="stat-value">{projectsCount}</span>
            <span className="stat-label">Active Projects</span>
          </div>
        </div>

        <div className="stat-card glass-panel">
          <div className="stat-icon-wrapper">
            <FileCode2 className="stat-icon indigo" size={22} />
          </div>
          <div className="stat-data">
            <span className="stat-value">{promptsCount}</span>
            <span className="stat-label">Total Prompts</span>
          </div>
        </div>

        <div className="stat-card glass-panel">
          <div className="stat-icon-wrapper">
            <Clock className="stat-icon yellow" size={22} />
          </div>
          <div className="stat-data">
            <span className="stat-value">{(avgLatency / 1000).toFixed(2)}s</span>
            <span className="stat-label">Avg. Latency</span>
          </div>
        </div>

        <div className="stat-card glass-panel">
          <div className="stat-icon-wrapper">
            <TrendingUp className="stat-icon green" size={22} />
          </div>
          <div className="stat-data">
            <span className="stat-value">{totalTokensUsed.toLocaleString()}</span>
            <span className="stat-label">Tokens Processed</span>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      {recentRuns.length > 0 && (
        <div className="charts-grid">
          <div className="chart-card glass-panel">
            <h3>Latency Trend (Recent Runs)</h3>
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={latencyData}>
                  <defs>
                    <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} label={{ value: 'Seconds', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', style: { fontSize: 11 } }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  />
                  <Area type="monotone" dataKey="latency" name="Latency (s)" stroke="var(--accent-primary)" fillOpacity={1} fill="url(#colorLatency)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-card glass-panel">
            <h3>Usage by Model</h3>
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={modelChartData}>
                  <XAxis dataKey="model" stroke="var(--text-muted)" fontSize={10} tickFormatter={(v) => v.length > 12 ? `${v.substring(0, 10)}...` : v} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} allowDecimals={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  />
                  <Bar dataKey="count" name="Runs Count" fill="var(--accent-secondary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Recent History Table */}
      <div className="history-section glass-panel">
        <div className="section-header">
          <h3>Recent Prompts Execution History</h3>
          {recentRuns.length > 0 && (
            <button className="btn btn-secondary btn-danger-hover" onClick={handleClearHistory}>
              <Trash2 size={14} /> Clear History
            </button>
          )}
        </div>

        {recentRuns.length === 0 ? (
          <div className="empty-history">
            <Play size={36} className="empty-icon" />
            <p>No runs captured yet. Head over to the Prompt Studio or A/B Arena to run prompts!</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Project / Prompt</th>
                  <th>Model</th>
                  <th>Latency</th>
                  <th>Tokens</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="timestamp-cell">
                      {new Date(run.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td>
                      <div className="prompt-meta-cell">
                        <span className="proj-name">{run.projectName || 'Playground'}</span>
                        <span className="prm-name">{run.promptName || 'Ad-hoc Prompt'}</span>
                      </div>
                    </td>
                    <td>
                      <span className="model-badge">
                        {run.model.replace('ollama/', 'ollama: ')}
                      </span>
                    </td>
                    <td>
                      {run.metrics.durationMs >= 1000 
                        ? `${(run.metrics.durationMs / 1000).toFixed(2)}s` 
                        : `${run.metrics.durationMs}ms`}
                    </td>
                    <td className="tokens-cell">
                      {run.metrics.tokenUsage.totalTokens.toLocaleString()}
                      <span className="tokens-split">
                        ({run.metrics.tokenUsage.inputTokens}i / {run.metrics.tokenUsage.outputTokens}o)
                      </span>
                    </td>
                    <td>
                      {run.passed !== undefined ? (
                        run.passed ? (
                          <span className="badge badge-success">Passed</span>
                        ) : (
                          <span className="badge badge-danger">Failed</span>
                        )
                      ) : (
                        <span className="badge badge-secondary">Success</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
