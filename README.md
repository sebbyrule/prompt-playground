# PromptForge (Prompt Playground)

**PromptForge** is a premium, developer-centric Prompt Engineering Playground, LLM A/B Battle Arena, and Agent Sandbox built with React, TypeScript, and Node.js. 

It acts as a local prompt IDE and serving gateway, enabling developers to test, version, evaluate, optimize, and serve LLM prompts directly from their local environment. All configurations, prompt versions, tools, and agent skills are persisted directly as JSON databases inside the `data/` folder, allowing prompts to be version-controlled, audited, and branched using **Git**.

---

## 🌟 Key Features

### 1. Prompt Studio (IDE & Version Control)
*   **Hierarchical Workspace**: Organize prompt templates into logical projects.
*   **Variable Interpolation**: Write templates with `{{variable_name}}` placeholders. PromptForge automatically generates input fields in the testing pane.
*   **Strict Version Tracking**: Every save creates a new prompt version. Browse history commits directly.
*   **Git Diff Restorer**: Integrates with local Git to trace history on `projects.json`. Click any commit to view a side-by-side visual diff comparisons of the template and restore previous versions in one click.
*   **Multimodal Support**: Attach images directly to support vision-capable models (e.g. Gemini 1.5/2.5, GPT-4o, Claude 3.5).
*   **Export Code Snippets**: Generate clean, ready-to-run JS and Python boilerplate code using official SDKs (Gemini, Claude, OpenAI) for your prompts.

### 2. A/B Model Arena & Blind Elo Battles
*   **Multi-Model Testing**: Run up to 4 variations of prompt templates or LLM models concurrently to compare output structure, response latencies, and token counts.
*   **Blind Battle Arena**: Run prompt templates side-by-side with masked model names and hidden metrics to eliminate cognitive bias.
*   **Dynamic Elo Rating Engine**: Vote on candidate responses to update model ratings using matchmaking equations. Results are persisted in `data/elo.json`.
*   **Model Leaderboard**: Ranks models by Elo rating, showing win/loss/tie statistics and win percentages.

### 3. Assertions Evaluator
*   **Unit-Test Your Prompts**: Define custom test cases with variable inputs and matching criteria assertions.
*   **Assertion Types**: Supports *Contains Substring*, *Regex Matching*, and *LLM-as-a-Judge* semantic evaluations.
*   **Bulk Dataset Importer**: Load test cases in bulk using JSON or CSV datasets. Columns are automatically mapped to prompt variables, and contains-criteria bounds are auto-generated.
*   **Parallel Execution Runs**: Visual progress bars and pass/fail indicators display detailed success percentages.

### 4. Auto-Improvement Optimizer
*   **Meta-Prompting Upgrades**: Input target goals, success criteria, and bad examples. The engine optimizes prompt templates, generating candidates ranging from *Refined* to *Structured* and *Creative*.
*   **Apply Candidates**: Inspect visual diffs of optimized prompt versions and immediately commit them to your active template.

### 5. Tools & Skills Agent Sandbox
*   **Visual Tool Builder**: Design custom functions and visually compile OpenAPI JSON schemas. Specify mock JSON payloads or write custom asynchronous JavaScript code to execute inside a backend VM sandbox.
*   **Agent Skills Orchestrator**: Create specialized agents by giving them a system identity persona and linking multiple tools via checklists.
*   **Step-by-Step Interactive Tester**:
    *   *Auto-Simulation*: Automatically executes model runs and simulates tool integrations.
    *   *Manual Interception*: Pauses model execution when tool calls are requested, letting developers edit raw JSON parameters and inject custom mock values on the fly.
*   **Persistent Conversations & Metrics**: Chat sessions are persisted in local files. The UI tracks cumulative cost, durations, and token counts.
*   **Interactive Convo Rewinding**: Instantly roll back conversations to previous turns, clean up trace histories, and re-run steps.
*   ** DuckDuckGo Web Scraper**: Built-in system tools (`system_web_search` and `system_web_scraper`) allow models to browse real-time facts and scrape web pages.

### 6. Local Gateway serving API
*   Serve prompt templates as instant production-ready endpoints:
    `POST /api/serve/:promptId`
    Accepts variables and model overrides, executes runs, logs usage, and returns results.

---

## 🛠️ Technology Stack

*   **Frontend**: React 19, Vite, TypeScript, Vanilla CSS (rich slate layouts, glassmorphic headers, neon glow borders), Lucide Icons, Recharts.
*   **Backend**: Node.js, Express, Nodemon, Node child process integrations, DuckDuckGo Scrapers.
*   **Supported Providers**: Google Gemini SDK, Anthropic Claude API, OpenAI Chat Completions, LM Studio (local offline models), Ollama.

---

## 📁 Repository Structure

```text
├── data/                       # Local Git-versioned JSON Databases
│   ├── projects.json           # Projects, prompt templates, and versions
│   ├── tools.json              # Custom agent tools schemas and JS scripts
│   └── skills.json             # Agent personas and tool mappings
├── server/                     # Express Backend Router
│   ├── server.js               # Unified LLM call handlers, tool sandboxes, and APIs
│   └── db.js                   # Simple JSON database interface
├── src/                        # React Frontend Application
│   ├── components/             # Reusable UI views and panels
│   │   ├── PromptStudio.tsx    # Prompt IDE, diff viewer, and history
│   │   ├── ABTesting.tsx       # A/B testing matrix and Blind Battles
│   │   ├── Evaluator.tsx       # Test suite runner and dataset loader
│   │   ├── Optimizer.tsx       # Meta-prompt auto-improver
│   │   ├── AgentWorkspace.tsx  # Tools builder, Skill config, and chat console
│   │   ├── Dashboard.tsx       # Performance logs, charts, and metrics
│   │   └── Settings.tsx        # Secure client key vault
│   ├── App.tsx                 # Main layout and tab router
│   └── index.css               # Design system token definitions
├── package.json                # Dependency packages and run scripts
└── README.md                   # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18 or higher)
*   npm (v9 or higher)

### Setup Instructions
1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/yourusername/prompt-forge.git
    cd prompt-forge
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Start Development Server**:
    Run client (Vite on port 5173) and server (Express on port 5001) concurrently:
    ```bash
    npm run dev
    ```

4.  **Configure API Credentials**:
    *   Open your browser to `http://localhost:5173/`.
    *   Navigate to **Settings** in the sidebar.
    *   Input API keys for Gemini, Claude, or OpenAI. For local offline models, configure your running Ollama or LM Studio endpoints.
    *   *Note: Keys are saved securely in your browser's LocalStorage and only passed to the local backend proxy to bypass CORS restrictions.*

---

## 🧪 Mock Data for Testing
The application is pre-seeded with datasets to help you test immediately:
1.  **Prompts**: `Sentiment & Review Analyzer` (multimodal JSON classifier), `AI Code Assistant` (security reviewer), and `Text Editor` (grammar checker).
2.  **Tools**: `fetch_weather`, `generate_password`, and `convert_currency` with live JavaScript VM sandboxed executors.
3.  **Skills**: `Smart Travel Assistant` (plans itineraries based on weather/conversions) and `Financial Advisory Agent` (tracks assets using stock quotes).
