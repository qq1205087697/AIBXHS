import React, { useState } from 'react'
import { Modal, Form, Input, Button, message } from 'antd'
import { Lock } from 'lucide-react'
import { authApi } from '../api'

interface ChangePasswordModalProps {
  open: boolean
  onCancel: () => void
  onSuccess?: () => void
}

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ open, onCancel, onSuccess }) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (values: { oldPassword: string; newPassword: string; confirmPassword: string }) => {
    // 验证两次密码是否一致
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的密码不一致')
      return
    }

    // 验证新密码长度
    if (values.newPassword.length < 6) {
      message.error('新密码长度至少6位')
      return
    }

    setLoading(true)
    try {
      const res = await authApi.changePassword(values.oldPassword, values.newPassword)
      if (res.data.success) {
        message.success('密码修改成功')
        form.resetFields()
        onCancel()
        onSuccess?.()
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '密码修改失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
        title="修改密码"
        open={open}
        onCancel={onCancel}
        footer={null}
        destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ oldPassword: '', newPassword: '', confirmPassword: '' }}
      >
        <Form.Item
          name="oldPassword"
          label="旧密码"
          rules={[{ required: true, message: '请输入旧密码' }]}
        >
          <Input.Password
            prefix={<Lock size={16} />}
            placeholder="请输入旧密码"
          />
        </Form.Item>

        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '密码长度至少6位' }
          ]}
        >
          <Input.Password
            prefix={<Lock size={16} />}
            placeholder="请输入新密码（至少6位）"
          />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          rules={[
            { required: true, message: '请确认新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error('两次输入的密码不一致'))
              }
            })
          ]}
        >
          <Input.Password
            prefix={<Lock size={16} />}
            placeholder="请再次输入新密码"
          />
        </Form.Item>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            确认修改
          </Button>
        </div>
      </Form>
    </Modal>
  )
}

export default ChangePasswordModal
