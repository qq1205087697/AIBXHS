import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, Alert } from 'antd';
import { Lock, User, Mail, Globe, Package, MessageSquare } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

const { Title, Text } = Typography;

const Register: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const { currentTheme } = useTheme();
  const navigate = useNavigate();

  const onFinish = async (values: { 
    username: string; 
    email: string; 
    password: string; 
    confirmPassword: string;
    nickname?: string;
  }) => {
    if (values.password !== values.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      await register(values.username, values.email, values.password, values.nickname);
      navigate('/');
    } catch (error: any) {
      setError(error.response?.data?.detail || '注册失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      margin: 0,
      padding: 0,
      overflow: 'hidden'
    }}>
      {/* 左侧图片区域 */}
      <div style={{
        flex: 1,
        background: `linear-gradient(135deg, ${currentTheme.primaryDark} 0%, ${currentTheme.primary} 100%)`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* 装饰元素 */}
        <div style={{
          position: 'absolute',
          top: '-50px',
          right: '-50px',
          width: '300px',
          height: '300px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '50%'
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-80px',
          left: '-80px',
          width: '400px',
          height: '400px',
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '50%'
        }} />

        {/* 图标区域 */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '30px', zIndex: 1 }}>
          <div style={{
            background: 'rgba(255,255,255,0.15)',
            padding: '20px',
            borderRadius: '16px',
            backdropFilter: 'blur(10px)'
          }}>
            <Globe size={40} color="white" />
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.15)',
            padding: '20px',
            borderRadius: '16px',
            backdropFilter: 'blur(10px)'
          }}>
            <Package size={40} color="white" />
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.15)',
            padding: '20px',
            borderRadius: '16px',
            backdropFilter: 'blur(10px)'
          }}>
            <MessageSquare size={40} color="white" />
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.15)',
            padding: '20px',
            borderRadius: '16px',
            backdropFilter: 'blur(10px)'
          }}>
            <Mail size={40} color="white" />
          </div>
        </div>

        {/* 主标题 */}
        <Title level={2} style={{ 
          color: 'white', 
          textAlign: 'center',
          zIndex: 1,
          fontWeight: 700,
          fontSize: '36px',
          marginBottom: '16px'
        }}>
          宝鑫华盛跨境生态链
        </Title>
        
        {/* 副标题 */}
        <Text style={{ 
          color: 'rgba(255,255,255,0.9)', 
          textAlign: 'center',
          fontSize: '16px',
          zIndex: 1,
          maxWidth: '400px'
        }}>
          AI赋能数据分析 · 高效库存管理 · 高效KPI管理
        </Text>

        {/* 底部装饰文字 */}
        <div style={{
          position: 'absolute',
          bottom: '40px',
          left: '40px',
          color: 'rgba(255,255,255,0.3)',
          fontSize: '12px'
        }}>
          © 2026 宝鑫华盛 · 为跨境电商赋能
        </div>
      </div>

      {/* 右侧注册表单区域 */}
      <div style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#f8fafc',
        padding: '40px',
        overflowY: 'auto'
      }}>
        <Card 
          style={{ 
            width: '100%', 
            maxWidth: 450,
            boxShadow: '0 20px 60px rgba(0,0,0,0.08)',
            borderRadius: '20px',
            border: 'none'
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{
              display: 'inline-flex',
              width: '64px',
              height: '64px',
              background: `linear-gradient(135deg, ${currentTheme.primaryDark} 0%, ${currentTheme.primary} 100%)`,
              borderRadius: '16px',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: '20px'
            }}>
              <MessageSquare size={36} color="white" />
            </div>
            <Title level={3} style={{ color: '#1a1a1a', margin: 0, fontWeight: 600 }}>
              创建新账户
            </Title>
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: '14px' }}>
              加入我们，开启跨境电商智能之旅
            </Text>
          </div>

          {error && (
            <Alert message={error} type="error" showIcon style={{ marginBottom: 20, borderRadius: '8px' }} />
          )}

          <Form
            name="register"
            onFinish={onFinish}
            autoComplete="off"
            layout="vertical"
          >
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input 
                prefix={<User size={18} style={{ color: '#94a3b8' }} />} 
                placeholder="请输入用户名" 
                size="large"
                style={{ borderRadius: '10px', height: '48px' }}
              />
            </Form.Item>

            <Form.Item
              name="email"
              label="邮箱"
              rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '请输入有效的邮箱地址' }
              ]}
            >
              <Input 
                prefix={<Mail size={18} style={{ color: '#94a3b8' }} />} 
                placeholder="请输入邮箱" 
                size="large"
                style={{ borderRadius: '10px', height: '48px' }}
              />
            </Form.Item>

            <Form.Item
              name="nickname"
              label="昵称（可选）"
            >
              <Input 
                placeholder="请输入昵称" 
                size="large"
                style={{ borderRadius: '10px', height: '48px' }}
              />
            </Form.Item>

            <Form.Item
              name="password"
              label="密码"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码长度至少为6位' }
              ]}
            >
              <Input.Password
                prefix={<Lock size={18} style={{ color: '#94a3b8' }} />}
                placeholder="请输入密码"
                size="large"
                style={{ borderRadius: '10px', height: '48px' }}
              />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label="确认密码"
              rules={[
                { required: true, message: '请确认密码' },
                { min: 6, message: '密码长度至少为6位' }
              ]}
            >
              <Input.Password
                prefix={<Lock size={18} style={{ color: '#94a3b8' }} />}
                placeholder="请再次输入密码"
                size="large"
                style={{ borderRadius: '10px', height: '48px' }}
              />
            </Form.Item>

            <Form.Item style={{ marginTop: '24px' }}>
              <Button 
                type="primary" 
                htmlType="submit" 
                size="large" 
                block
                loading={loading}
                style={{ 
                  background: `linear-gradient(135deg, ${currentTheme.primaryDark} 0%, ${currentTheme.primary} 100%)`,
                  height: '48px',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: 500,
                  border: 'none'
                }}
              >
                注册
              </Button>
            </Form.Item>

            <div style={{ textAlign: 'center', marginTop: '24px' }}>
              <Text style={{ color: '#64748b' }}>
                已有账户？
                <Link to="/login" style={{ 
                  color: currentTheme.primary, 
                  fontWeight: 500,
                  marginLeft: '4px'
                }}>
                  立即登录
                </Link>
              </Text>
            </div>
          </Form>
        </Card>
      </div>
    </div>
  );
};

export default Register;
