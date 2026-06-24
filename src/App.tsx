import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { PromptStudio } from './components/PromptStudio';
import { ABTesting } from './components/ABTesting';
import { Evaluator } from './components/Evaluator';
import { Optimizer } from './components/Optimizer';
import { Settings } from './components/Settings';
import { AgentWorkspace } from './components/AgentWorkspace';

function App() {
  const [currentView, setCurrentView] = useState<string>('dashboard');

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'studio':
        return <PromptStudio />;
      case 'ab-testing':
        return <ABTesting />;
      case 'evaluator':
        return <Evaluator />;
      case 'optimizer':
        return <Optimizer />;
      case 'agent-workspace':
        return <AgentWorkspace />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className="main-content">
        {renderView()}
      </main>
    </div>
  );
}

export default App;
