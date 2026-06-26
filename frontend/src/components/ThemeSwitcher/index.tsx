import React from 'react'
import { Dropdown, Button } from 'antd'
import { Palette } from 'lucide-react'
import { useTheme, themes } from '../../contexts/ThemeContext'

const ThemeSwitcher: React.FC = () => {
  const { currentTheme, setThemeIndex } = useTheme()

  const menuItems = themes.map((theme, index) => ({
    key: index.toString(),
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            backgroundColor: theme.primary,
            border: currentTheme.name === theme.name ? '2px solid #333' : '2px solid transparent',
          }}
        />
        <span>{theme.name}</span>
      </div>
    ),
    onClick: () => setThemeIndex(index),
  }))

  return (
    <Dropdown
      menu={{ items: menuItems, selectedKeys: [themes.findIndex(t => t.name === currentTheme.name).toString()] }}
      placement="bottomRight"
      arrow
    >
      <Button
        type="text"
        icon={<Palette size={20} style={{ color: currentTheme.primary }} />}
        style={{ color: currentTheme.primary, width: '40px', padding: 0 }}
      />
    </Dropdown>
  )
}

export default ThemeSwitcher
