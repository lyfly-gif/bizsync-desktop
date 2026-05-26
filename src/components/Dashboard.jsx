import { useState } from 'react';
import Sidebar from './Sidebar';
import ChatInterface from './ChatInterface';
import ProjectsInterface from './ProjectsInterface';
import GanttInterface from './GanttInterface';
import UsersInterface from './UsersInterface';
import SettingsPage from './SettingsPage';

export default function Dashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState('projects');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const role = user.role || 'user';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar role={role} currentUser={user} activeTab={activeTab} onTabChange={setActiveTab} onLogout={onLogout} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'chat' ? '' : 'hidden'}`}>
          <ChatInterface onSwitch={() => setActiveTab('projects')} onGoSettings={() => setActiveTab('settings')} />
        </div>
        {activeTab === 'projects' && <ProjectsInterface />}
        {activeTab === 'gantt' && <GanttInterface />}
        {activeTab === 'users' && role === 'admin' && <UsersInterface />}
        {activeTab === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}
