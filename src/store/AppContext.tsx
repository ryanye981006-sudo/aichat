import { createContext, useContext, useReducer, ReactNode } from 'react';
import type { Assistant, Provider, Model, Conversation, Message, MemorySettings } from '../types';

// 应用全局状态
interface AppState {
  assistants: Assistant[];
  providers: Provider[];
  models: Model[];
  conversations: Conversation[];
  messages: Message[];
  memorySettings: MemorySettings | null;
  activeAssistantId: string | null;
  activeConversationId: string | null;
  isStreaming: boolean;
  isSettingsMode: boolean;
  settingsTab: 'model' | 'memory';
}

type AppAction =
  | { type: 'SET_ASSISTANTS'; payload: Assistant[] }
  | { type: 'ADD_ASSISTANT'; payload: Assistant }
  | { type: 'UPDATE_ASSISTANT'; payload: Assistant }
  | { type: 'REMOVE_ASSISTANT'; payload: string }
  | { type: 'SET_PROVIDERS'; payload: Provider[] }
  | { type: 'ADD_PROVIDER'; payload: Provider }
  | { type: 'UPDATE_PROVIDER'; payload: Provider }
  | { type: 'REMOVE_PROVIDER'; payload: string }
  | { type: 'SET_MODELS'; payload: Model[] }
  | { type: 'ADD_MODEL'; payload: Model }
  | { type: 'REMOVE_MODEL'; payload: string }
  | { type: 'SET_CONVERSATIONS'; payload: Conversation[] }
  | { type: 'ADD_CONVERSATION'; payload: Conversation }
  | { type: 'UPDATE_CONVERSATION'; payload: Conversation }
  | { type: 'REMOVE_CONVERSATION'; payload: string }
  | { type: 'SET_MESSAGES'; payload: Message[] }
  | { type: 'ADD_MESSAGE'; payload: Message }
  | { type: 'UPDATE_MESSAGE'; payload: { id: string; updates: Partial<Message> } }
  | { type: 'SET_ACTIVE_ASSISTANT'; payload: string | null }
  | { type: 'SET_ACTIVE_CONVERSATION'; payload: string | null }
  | { type: 'SET_STREAMING'; payload: boolean }
  | { type: 'SET_SETTINGS_MODE'; payload: boolean }
  | { type: 'SET_SETTINGS_TAB'; payload: 'model' | 'memory' }
  | { type: 'SET_MEMORY_SETTINGS'; payload: MemorySettings };

const initialState: AppState = {
  assistants: [],
  providers: [],
  models: [],
  conversations: [],
  messages: [],
  memorySettings: null,
  activeAssistantId: null,
  activeConversationId: null,
  isStreaming: false,
  isSettingsMode: false,
  settingsTab: 'model',
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ASSISTANTS': return { ...state, assistants: action.payload };
    case 'ADD_ASSISTANT': return { ...state, assistants: [action.payload, ...state.assistants] };
    case 'UPDATE_ASSISTANT': return { ...state, assistants: state.assistants.map(a => a.id === action.payload.id ? action.payload : a) };
    case 'REMOVE_ASSISTANT': return { ...state, assistants: state.assistants.filter(a => a.id !== action.payload) };
    case 'SET_PROVIDERS': return { ...state, providers: action.payload };
    case 'ADD_PROVIDER': return { ...state, providers: [...state.providers, action.payload] };
    case 'UPDATE_PROVIDER': return { ...state, providers: state.providers.map(p => p.id === action.payload.id ? action.payload : p) };
    case 'REMOVE_PROVIDER': return { ...state, providers: state.providers.filter(p => p.id !== action.payload) };
    case 'SET_MODELS': return { ...state, models: action.payload };
    case 'ADD_MODEL': return { ...state, models: [...state.models, action.payload] };
    case 'REMOVE_MODEL': return { ...state, models: state.models.filter(m => m.id !== action.payload) };
    case 'SET_CONVERSATIONS': return { ...state, conversations: action.payload };
    case 'ADD_CONVERSATION': return { ...state, conversations: [action.payload, ...state.conversations] };
    case 'UPDATE_CONVERSATION': return { ...state, conversations: state.conversations.map(c => c.id === action.payload.id ? action.payload : c) };
    case 'REMOVE_CONVERSATION': return { ...state, conversations: state.conversations.filter(c => c.id !== action.payload) };
    case 'SET_MESSAGES': return { ...state, messages: action.payload };
    case 'ADD_MESSAGE': return { ...state, messages: [...state.messages, action.payload] };
    case 'UPDATE_MESSAGE': return { ...state, messages: state.messages.map(m => m.id === action.payload.id ? { ...m, ...action.payload.updates } : m) };
    case 'SET_ACTIVE_ASSISTANT': return { ...state, activeAssistantId: action.payload };
    case 'SET_ACTIVE_CONVERSATION': return { ...state, activeConversationId: action.payload };
    case 'SET_STREAMING': return { ...state, isStreaming: action.payload };
    case 'SET_SETTINGS_MODE': return { ...state, isSettingsMode: action.payload };
    case 'SET_SETTINGS_TAB': return { ...state, settingsTab: action.payload };
    case 'SET_MEMORY_SETTINGS': return { ...state, memorySettings: action.payload };
    default: return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextType>({ state: initialState, dispatch: () => {} });

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return <AppContext value={{ state, dispatch }}>{children}</AppContext>;
}

export function useAppState() {
  return useContext(AppContext);
}
