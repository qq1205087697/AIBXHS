import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface ThemeConfig {
  name: string;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  primaryBg: string;
  avatarBg: string;
  userMessageBg: string;
  selectedBg: string;
}

export const themes: ThemeConfig[] = [
  {
    name: '紫罗兰',
    primary: '#7e57c2',
    primaryLight: '#b39ddb',
    primaryDark: '#5e35b1',
    primaryBg: '#f3e5f5',
    avatarBg: '#7e57c2',
    userMessageBg: '#7e57c2',
    selectedBg: '#f3e5f5',
  },
  {
    name: '天空蓝',
    primary: '#2196f3',
    primaryLight: '#90caf9',
    primaryDark: '#1565c0',
    primaryBg: '#e3f2fd',
    avatarBg: '#2196f3',
    userMessageBg: '#2196f3',
    selectedBg: '#e3f2fd',
  },
  {
    name: '翡翠绿',
    primary: '#009688',
    primaryLight: '#80cbc4',
    primaryDark: '#00695c',
    primaryBg: '#e0f2f1',
    avatarBg: '#009688',
    userMessageBg: '#009688',
    selectedBg: '#e0f2f1',
  },
  {
    name: '珊瑚橙',
    primary: '#ff7043',
    primaryLight: '#ffab91',
    primaryDark: '#e64a19',
    primaryBg: '#fbe9e7',
    avatarBg: '#ff7043',
    userMessageBg: '#ff7043',
    selectedBg: '#fbe9e7',
  },
  {
    name: '玫瑰红',
    primary: '#ec407a',
    primaryLight: '#f48fb1',
    primaryDark: '#c2185b',
    primaryBg: '#fce4ec',
    avatarBg: '#ec407a',
    userMessageBg: '#ec407a',
    selectedBg: '#fce4ec',
  },
  {
    name: '青柠绿',
    primary: '#8bc34a',
    primaryLight: '#c5e1a5',
    primaryDark: '#558b2f',
    primaryBg: '#f1f8e9',
    avatarBg: '#8bc34a',
    userMessageBg: '#8bc34a',
    selectedBg: '#f1f8e9',
  },
];

interface ThemeContextType {
  currentTheme: ThemeConfig;
  setTheme: (theme: ThemeConfig) => void;
  themeIndex: number;
  setThemeIndex: (index: number) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'app-theme-index';

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [themeIndex, setThemeIndexState] = useState(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved ? parseInt(saved, 10) : 0;
  });

  const currentTheme = themes[themeIndex] || themes[0];

  const setThemeIndex = (index: number) => {
    if (index >= 0 && index < themes.length) {
      setThemeIndexState(index);
      localStorage.setItem(THEME_STORAGE_KEY, index.toString());
    }
  };

  const setTheme = (theme: ThemeConfig) => {
    const index = themes.findIndex(t => t.name === theme.name);
    if (index !== -1) {
      setThemeIndex(index);
    }
  };

  useEffect(() => {
    document.documentElement.style.setProperty('--theme-primary', currentTheme.primary);
    document.documentElement.style.setProperty('--theme-primary-light', currentTheme.primaryLight);
    document.documentElement.style.setProperty('--theme-primary-dark', currentTheme.primaryDark);
    document.documentElement.style.setProperty('--theme-primary-bg', currentTheme.primaryBg);
  }, [currentTheme]);

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, themeIndex, setThemeIndex }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
