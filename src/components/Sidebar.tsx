import React from 'react';
import './Sidebar.css';
import { 
  LayoutDashboard, 
  Terminal, 
  Split, 
  CheckSquare, 
  Sparkles, 
  Settings as SettingsIcon,
  MessageSquareCode,
  Cpu
} from 'lucide-react';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'studio', label: 'Prompt Studio', icon: Terminal },
    { id: 'ab-testing', label: 'A/B Arena', icon: Split },
    { id: 'evaluator', label: 'Evaluator', icon: CheckSquare },
    { id: 'optimizer', label: 'Auto-Optimizer', icon: Sparkles },
    { id: 'agent-workspace', label: 'Tools & Skills', icon: Cpu },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <MessageSquareCode className="brand-icon" size={24} />
        <span className="brand-text">PromptForge</span>
      </div>
      
      <nav className="sidebar-nav">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onViewChange(item.id)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      
      <div className="sidebar-footer">
        <span className="version-label">v1.0.0 (Local Dev)</span>
      </div>
    </aside>
  );
};
