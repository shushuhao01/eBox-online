<template>
  <div class="page-container">
    <el-card shadow="never" class="settings-card">
      <el-tabs v-model="activeTab">
        <!-- 授权策略 -->
        <el-tab-pane label="授权策略" name="policy">
          <div class="tab-body">
            <div class="form-item">
              <div class="form-label">
                心跳间隔 <span class="hint">（1 ~ 24 小时，当前 {{ policy.heartbeat_interval_hours }} 小时）</span>
              </div>
              <el-slider
                v-model="policy.heartbeat_interval_hours"
                :min="1"
                :max="24"
                :marks="{ 1: '1h', 6: '6h', 12: '12h', 24: '24h' }"
                style="width: 480px; max-width: 100%"
              />
            </div>

            <el-divider />

            <div class="form-item">
              <div class="form-label">强制在线激活</div>
              <el-switch
                v-model="forceOnline"
                active-text="开启"
                inactive-text="关闭"
                inline-prompt
              />
              <span class="hint">开启后，激活时必须在线校验</span>
            </div>

            <el-divider />

            <div class="form-item">
              <div class="form-label">心跳漏报宽限</div>
              <el-input-number v-model="policy.online_threshold_minutes" :min="1" :max="1440" />
              <span class="hint">
                设备最后心跳距今不超过「在线窗口」即视为在线；在线窗口 = 心跳间隔 + 宽限 = 当前 {{ onlineWindowMin }} 分钟（分钟）
              </span>
            </div>

            <el-divider />

            <div class="form-item">
              <div class="form-label">
                系统公告
                <span class="hint">客户端首页公告栏；按发送方式保存设置即生效推送，也可直接点「立即发送」</span>
              </div>

              <div class="notice-status">
                <template v-if="publishedNotice">
                  <el-tag type="success" size="small" effect="dark">已发布</el-tag>
                  <span class="notice-status-text">《{{ publishedNotice.title || '无标题' }}》{{ formatTime(publishedNotice.publishedAt) }}</span>
                </template>
                <el-tag v-else type="info" size="small">未发布</el-tag>

                <template v-if="pendingNotice">
                  <el-tag type="warning" size="small" effect="dark">待定时</el-tag>
                  <span class="notice-status-text">{{ formatTime(pendingNotice.publishAt) }} 自动发送</span>
                  <el-button link type="warning" @click="handleCancelSchedule">取消定时</el-button>
                </template>

                <el-tag :type="streamClients > 0 ? 'success' : 'info'" size="small" effect="plain">
                  实时连接 {{ streamClients }}
                </el-tag>
              </div>

              <div class="notice-editor">
                <el-input
                  v-model="noticeForm.title"
                  maxlength="80"
                  show-word-limit
                  placeholder="公告标题（客户端公告栏显示，最长 2 行）"
                />

                <el-input
                  v-model="noticeForm.content"
                  type="textarea"
                  :rows="5"
                  maxlength="2000"
                  show-word-limit
                  placeholder="公告详情（可选）：填写后客户端点击公告栏弹出详情窗口"
                />
              </div>

              <div class="notice-options">
                <span class="notice-option-label">强提醒</span>
                <el-switch v-model="noticeForm.strong" active-text="开启" inactive-text="关闭" inline-prompt />
                <span class="hint">开启后公告栏以深红底白字高亮，提醒用户注意</span>
              </div>

              <div class="notice-options">
                <span class="notice-option-label">跳转链接</span>
                <el-input
                  v-model="noticeForm.link"
                  maxlength="500"
                  placeholder="https://（可选，配置后客户端详情窗口显示「详情」）"
                  style="width: 360px; max-width: 100%"
                />
              </div>

              <div class="notice-options">
                <span class="notice-option-label">发送方式</span>
                <el-radio-group v-model="sendMode">
                  <el-radio-button label="now">立即发送</el-radio-button>
                  <el-radio-button label="schedule">定时发送</el-radio-button>
                </el-radio-group>
                <el-date-picker
                  v-if="sendMode === 'schedule'"
                  v-model="sendAt"
                  type="datetime"
                  placeholder="选择发送时间"
                  format="YYYY-MM-DD HH:mm:ss"
                  value-format="YYYY-MM-DD HH:mm:ss"
                  style="width: 200px"
                />
              </div>

              <div class="notice-preview-wrap">
                <span class="notice-option-label">效果预览</span>
                <div class="notice-preview" :class="{ strong: noticeForm.strong }">
                  <span class="np-tag">公告</span>
                  <span class="np-text">{{ previewTitle }}</span>
                  <span v-if="noticeForm.content || noticeForm.link" class="np-action">
                    {{ noticeForm.content ? '详情' : '查看' }}
                  </span>
                </div>
              </div>

              <div class="notice-actions">
                <el-button :loading="noticeSaving" @click="handleSaveDraft">保存草稿</el-button>
                <el-button
                  v-if="sendMode === 'now'"
                  type="primary"
                  :icon="Promotion"
                  :loading="noticeSending"
                  @click="handleSendNotice"
                >
                  立即发送
                </el-button>
                <el-button v-else type="primary" :icon="Timer" :loading="noticeSending" @click="handleScheduleNotice">
                  定时发送
                </el-button>
                <el-button
                  type="danger"
                  plain
                  :disabled="!publishedNotice && !pendingNotice"
                  :loading="noticeWithdrawing"
                  @click="handleWithdraw"
                >
                  撤销公告
                </el-button>
              </div>
            </div>

            <el-divider />

            <div class="form-item">
              <div class="form-label">
                日志自动清理 <span class="hint">操作日志与心跳日志超过保留天数后自动删除，避免日志堆积占用磁盘</span>
              </div>
              <div class="clean-row">
                <span class="clean-label">保留</span>
                <el-input-number v-model="policy.log_retention_days" :min="1" :max="365" style="width: 120px" />
                <span class="clean-label">天</span>
                <span class="clean-label">每日</span>
                <el-time-picker
                  v-model="policy.log_clean_time"
                  format="HH:mm"
                  value-format="HH:mm"
                  placeholder="清理时间"
                  style="width: 120px"
                />
                <span class="clean-label">自动清理过期日志</span>
                <el-button :icon="Delete" :loading="cleaning" @click="handleCleanLogs">立即清理</el-button>
              </div>
            </div>

            <el-divider />

            <div class="form-item">
              <el-button type="primary" :icon="Check" :loading="saving" @click="savePolicy">保存设置</el-button>
              <el-button :icon="RefreshLeft" @click="loadPolicy">重置</el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- 邮件发件 -->
        <el-tab-pane label="邮件发件" name="mail">
          <div class="tab-body">
            <div class="form-item">
              <div class="form-label">
                邮件发件 <span class="hint">用于验证码邮件、临期提醒与通知邮件</span>
              </div>
              <el-switch v-model="mailEnabled" active-text="开启" inactive-text="关闭" inline-prompt />
            </div>

            <el-divider />

            <div class="form-item">
              <div class="form-grid">
                <div class="grid-row">
                  <span class="grid-label">SMTP 主机</span>
                  <el-input v-model="mailForm.smtp_host" placeholder="smtp.example.com" style="width: 320px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">SMTP 端口</span>
                  <el-input v-model="mailForm.smtp_port" placeholder="465" style="width: 160px" />
                  <span class="hint">465 使用 TLS，其他端口走 STARTTLS</span>
                </div>
                <div class="grid-row">
                  <span class="grid-label">SMTP 账号</span>
                  <el-input v-model="mailForm.smtp_user" placeholder="noreply@example.com" style="width: 320px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">SMTP 密码</span>
                  <el-input
                    v-model="mailForm.smtp_pass"
                    type="password"
                    show-password
                    :placeholder="smtpPassSet ? '已设置（留空则不修改）' : '请输入 SMTP 密码'"
                    style="width: 320px"
                  />
                </div>
                <div class="grid-row">
                  <span class="grid-label">发件地址</span>
                  <el-input v-model="mailForm.smtp_from" placeholder="留空则使用 SMTP 账号" style="width: 320px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">发件人名称</span>
                  <el-input v-model="mailForm.mail_from_name" placeholder="eBox 授权服务" style="width: 320px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">站点地址</span>
                  <el-input v-model="mailForm.mail_site_url" placeholder="https://example.com（用于邮件内链接）" style="width: 420px" />
                </div>
              </div>
            </div>

            <el-divider />

            <div class="form-item">
              <div class="form-label">发送测试邮件</div>
              <div class="clean-row">
                <el-input v-model="mailTestTo" placeholder="测试收件人邮箱" style="width: 260px" />
                <el-button type="primary" plain :loading="mailTesting" @click="handleTestMail">发送测试邮件</el-button>
              </div>
            </div>

            <el-divider />

            <div class="form-item">
              <el-button type="primary" :icon="Check" :loading="mailSaving" @click="saveMailConfig">保存</el-button>
              <el-button :icon="RefreshLeft" @click="loadNotifyConfig">重置</el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- 短信配置 -->
        <el-tab-pane label="短信配置" name="sms">
          <div class="tab-body">
            <div class="form-item">
              <div class="form-label">
                短信发件 <span class="hint">基于阿里云短信服务（Dysmsapi 2017-05-25）</span>
              </div>
              <el-switch v-model="smsEnabled" active-text="开启" inactive-text="关闭" inline-prompt />
            </div>

            <el-divider />

            <div class="form-item">
              <div class="form-grid">
                <div class="grid-row">
                  <span class="grid-label">服务商</span>
                  <el-input model-value="阿里云" disabled style="width: 200px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">AccessKey ID</span>
                  <el-input v-model="smsForm.sms_access_key_id" placeholder="LTAI..." style="width: 320px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">AccessKey Secret</span>
                  <el-input
                    v-model="smsForm.sms_access_key_secret"
                    type="password"
                    show-password
                    :placeholder="smsSecretSet ? '已设置（留空则不修改）' : '请输入 AccessKey Secret'"
                    style="width: 320px"
                  />
                </div>
                <div class="grid-row">
                  <span class="grid-label">短信签名</span>
                  <el-input v-model="smsForm.sms_sign_name" placeholder="已在阿里云审核通过的签名" style="width: 320px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">Region</span>
                  <el-select v-model="smsForm.sms_region" style="width: 200px">
                    <el-option label="华东 1（杭州）" value="cn-hangzhou" />
                    <el-option label="华东 2（上海）" value="cn-shanghai" />
                    <el-option label="华北 2（北京）" value="cn-beijing" />
                    <el-option label="华南 1（深圳）" value="cn-shenzhen" />
                  </el-select>
                </div>
                <div class="grid-row">
                  <span class="grid-label">验证码模板 CODE</span>
                  <el-input v-model="smsForm.sms_tpl_verify_code" placeholder="SMS_xxxxxxxx" style="width: 240px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">管理员手机号</span>
                  <el-input v-model="smsForm.sms_admin_phone" placeholder="用于接收管理通知（可选）" style="width: 260px" />
                </div>
              </div>
            </div>

            <el-divider />

            <div class="form-item">
              <div class="form-label">连通性 / 测试发送</div>
              <div class="clean-row">
                <el-input v-model="smsTestPhone" placeholder="测试手机号" style="width: 220px" />
                <el-button :loading="smsConnTesting" @click="handleTestSmsConnection">测试连通</el-button>
                <el-button type="primary" plain :loading="smsTesting" @click="handleTestSms">发送测试短信</el-button>
              </div>
              <span class="hint">测试短信使用验证码模板 CODE，模板变量为 {code} = 123456</span>
            </div>

            <el-divider />

            <div class="form-item">
              <el-button type="primary" :icon="Check" :loading="smsSaving" @click="saveSmsConfig">保存</el-button>
              <el-button :icon="RefreshLeft" @click="loadNotifyConfig">重置</el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- 消息模板 -->
        <el-tab-pane label="消息模板" name="notify">
          <div class="tab-body">
            <div class="sub-card">
              <div class="sub-title">通知渠道</div>
              <div class="form-item">
                <div class="form-label">
                  全局通知 <span class="hint">关闭后仅写站内信，不再向钉钉 / 企业微信 / 邮件 / 短信外发</span>
                </div>
                <el-switch v-model="notifyGlobalEnabled" active-text="开启" inactive-text="关闭" inline-prompt />
              </div>

              <el-divider />

              <div class="form-grid">
                <div class="grid-row">
                  <span class="grid-label">钉钉 Webhook</span>
                  <el-input v-model="notifyForm.notify_dingtalk_url" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." style="width: 480px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">钉钉加签密钥</span>
                  <el-input
                    v-model="notifyForm.notify_dingtalk_secret"
                    type="password"
                    show-password
                    :placeholder="dingtalkSecretSet ? '已设置（留空则不修改）' : 'SEC...（可选，机器人加签）'"
                    style="width: 480px"
                  />
                </div>
                <div class="grid-row">
                  <span class="grid-label">企业微信 Webhook</span>
                  <el-input v-model="notifyForm.notify_wecom_url" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." style="width: 480px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">通知邮箱</span>
                  <el-input v-model="notifyForm.notify_email_to" placeholder="多个邮箱用逗号分隔，仅发送第一个" style="width: 480px" />
                </div>
                <div class="grid-row">
                  <span class="grid-label">通知手机号</span>
                  <el-input v-model="notifyForm.notify_sms_phone" placeholder="多个手机号用逗号分隔，仅发送第一个" style="width: 480px" />
                </div>
              </div>

              <div class="form-item" style="margin-top: 20px">
                <el-button type="primary" :icon="Check" :loading="notifySaving" @click="saveNotifyConfig">保存</el-button>
                <el-button :icon="RefreshLeft" @click="loadNotifyConfig">重置</el-button>
              </div>
            </div>

            <div class="sub-card">
              <div class="sub-title">消息模板</div>
              <div class="tpl-toolbar">
                <el-select v-model="tplQuery.category" placeholder="分类" clearable style="width: 130px" @change="searchTemplates">
                  <el-option label="账号" value="account" />
                  <el-option label="授权" value="license" />
                  <el-option label="系统" value="system" />
                </el-select>
                <el-input
                  v-model="tplQuery.keyword"
                  placeholder="编码 / 名称 / 标题"
                  clearable
                  style="width: 220px"
                  @keyup.enter="searchTemplates"
                />
                <el-button :icon="Search" @click="searchTemplates">查询</el-button>
                <el-button :icon="Plus" type="primary" @click="openTemplateDialog()">新建模板</el-button>
              </div>

              <el-table :data="tplList" v-loading="tplLoading" stripe>
                <el-table-column label="编码" min-width="160">
                  <template #default="{ row }">
                    <span class="code-font">{{ row.code }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="名称" min-width="150" prop="name" show-overflow-tooltip />
                <el-table-column label="分类" width="100">
                  <template #default="{ row }">{{ CATEGORY_LABELS[row.category] || row.category || '-' }}</template>
                </el-table-column>
                <el-table-column label="渠道" min-width="220">
                  <template #default="{ row }">
                    <el-tag
                      v-for="ch in channelList(row.channels)"
                      :key="ch"
                      size="small"
                      effect="plain"
                      :type="CHANNEL_META[ch]?.type || 'info'"
                      style="margin-right: 4px"
                    >
                      {{ CHANNEL_META[ch]?.label || ch }}
                    </el-tag>
                    <span v-if="!channelList(row.channels).length" class="text-secondary">-</span>
                  </template>
                </el-table-column>
                <el-table-column label="启用" width="80" align="center">
                  <template #default="{ row }">
                    <el-switch
                      v-model="row.isEnabled"
                      :active-value="1"
                      :inactive-value="0"
                      @change="changeTemplateSwitch(row, 'isEnabled')"
                    />
                  </template>
                </el-table-column>
                <el-table-column label="自动触发" width="90" align="center">
                  <template #default="{ row }">
                    <el-switch
                      v-model="row.autoTrigger"
                      :active-value="1"
                      :inactive-value="0"
                      @change="changeTemplateSwitch(row, 'autoTrigger')"
                    />
                  </template>
                </el-table-column>
                <el-table-column label="短信模板码" width="130">
                  <template #default="{ row }">{{ row.smsTemplateCode || '-' }}</template>
                </el-table-column>
                <el-table-column label="操作" width="150" fixed="right" align="center">
                  <template #default="{ row }">
                    <el-button link type="primary" size="small" @click="openTemplateDialog(row)">编辑</el-button>
                    <el-button link type="success" size="small" @click="openTestTemplate(row)">测试发送</el-button>
                  </template>
                </el-table-column>
                <template #empty><el-empty description="暂无消息模板" :image-size="80" /></template>
              </el-table>

              <div class="tpl-pager">
                <el-pagination
                  v-model:current-page="tplQuery.page"
                  v-model:page-size="tplQuery.pageSize"
                  :total="tplTotal"
                  :page-sizes="[20, 50, 100]"
                  layout="total, sizes, prev, pager, next, jumper"
                  @current-change="loadTemplates"
                  @size-change="searchTemplates"
                />
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- 账号安全 -->
        <el-tab-pane label="账号安全" name="account">
          <div class="tab-body">
            <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="90px" style="max-width: 420px">
              <el-form-item label="旧密码" prop="oldPassword">
                <el-input v-model="pwdForm.oldPassword" type="password" show-password placeholder="请输入原密码" />
              </el-form-item>
              <el-form-item label="新密码" prop="newPassword">
                <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="至少 6 位" />
              </el-form-item>
              <el-form-item label="确认密码" prop="confirm">
                <el-input v-model="pwdForm.confirm" type="password" show-password placeholder="再次输入新密码" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :icon="Lock" :loading="pwdSaving" @click="submitPassword">修改密码</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
      </el-tabs>

      <!-- 消息模板编辑 -->
      <el-dialog
        v-model="tplDialogVisible"
        :title="tplForm.id ? '编辑消息模板' : '新建消息模板'"
        width="700px"
        :close-on-click-modal="false"
      >
        <el-form label-width="110px">
          <el-form-item label="模板编码">
            <el-input v-model="tplForm.code" :disabled="!!tplForm.id" placeholder="大写字母 / 数字 / 下划线，保存后不可修改" style="width: 320px" />
          </el-form-item>
          <el-form-item label="模板名称">
            <el-input v-model="tplForm.name" placeholder="例如：注册成功通知" style="width: 320px" />
          </el-form-item>
          <el-form-item label="分类">
            <el-select v-model="tplForm.category" filterable allow-create default-first-option placeholder="account / license / system" style="width: 200px">
              <el-option label="账号" value="account" />
              <el-option label="授权" value="license" />
              <el-option label="系统" value="system" />
            </el-select>
          </el-form-item>
          <el-form-item label="标题">
            <el-input v-model="tplForm.title" placeholder="站内信 / 邮件 / 钉钉标题" style="width: 420px" />
          </el-form-item>
          <el-form-item label="正文">
            <el-input v-model="tplForm.content" type="textarea" :rows="6" placeholder="支持占位符：{username} {email} {code} {minutes} {version} {expire_at} {days} {site_name} {time}" />
          </el-form-item>
          <el-form-item label="通知渠道">
            <el-checkbox-group v-model="tplForm.channels">
              <el-checkbox label="SYSTEM">站内信</el-checkbox>
              <el-checkbox label="EMAIL">邮件</el-checkbox>
              <el-checkbox label="SMS">短信</el-checkbox>
              <el-checkbox label="DINGTALK">钉钉</el-checkbox>
              <el-checkbox label="WECOM">企业微信</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="短信模板 CODE">
            <el-input v-model="tplForm.sms_template_code" placeholder="SMS_xxxxxxxx（短信渠道必填）" style="width: 240px" />
          </el-form-item>
          <el-form-item label="启用">
            <el-switch v-model="tplForm.is_enabled" :active-value="1" :inactive-value="0" />
          </el-form-item>
          <el-form-item label="自动触发">
            <el-switch v-model="tplForm.auto_trigger" :active-value="1" :inactive-value="0" />
            <span class="hint">关闭后业务事件只写站内信，不外发</span>
          </el-form-item>
          <el-form-item label="排序">
            <el-input-number v-model="tplForm.sort_order" :min="0" :max="9999" />
          </el-form-item>
        </el-form>

        <div v-if="tplTestResults.length" class="test-results">
          <div class="test-results-title">测试结果</div>
          <div v-for="item in tplTestResults" :key="item.channel" class="test-result-row">
            <el-tag size="small" effect="plain" :type="CHANNEL_META[item.channel]?.type || 'info'">
              {{ CHANNEL_META[item.channel]?.label || item.channel }}
            </el-tag>
            <el-tag size="small" :type="item.status === 'ok' ? 'success' : item.status === 'fail' ? 'danger' : 'info'">
              {{ item.status === 'ok' ? '成功' : item.status === 'fail' ? '失败' : '跳过' }}
            </el-tag>
            <span class="test-result-text">{{ item.message }}</span>
          </div>
        </div>

        <template #footer>
          <el-button :disabled="!tplForm.id" :loading="tplTesting" @click="handleTestTemplate">测试发送</el-button>
          <el-button @click="tplDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="tplSaving" @click="saveTemplate">保存</el-button>
        </template>
      </el-dialog>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Check, RefreshLeft, Lock, Delete, Promotion, Timer, Search, Plus } from '@element-plus/icons-vue'
import {
  getConfig,
  updateConfig,
  cleanLogs,
  sendNotice,
  scheduleNotice,
  cancelScheduledNotice,
  withdrawNotice,
  type SystemConfig,
  type NoticePayload,
  type PendingNotice,
  type NoticeState,
  type NoticeSendResult,
} from '@/api/config'
import { changePassword } from '@/api/users'
import {
  getNotifyConfig,
  updateNotifyConfig,
  testMail,
  testSms,
  testSmsConnection,
  getTemplates,
  createTemplate,
  updateTemplate,
  testTemplate,
  type NotificationTemplateRow,
  type NotifyChannelResult,
} from '@/api/notify'
import { useUserStore } from '@/stores/user'

const activeTab = ref('policy')

// ============ 授权策略 ============
const policy = reactive<SystemConfig>({
  heartbeat_interval_hours: '6',
  offline_grace_days: '7',
  force_online_activate: '0',
  notice: '',
  notice_title: '',
  notice_content: '',
  notice_strong: '0',
  notice_link: '',
  notice_published: null,
  notice_pending_task: null,
  online_threshold_minutes: '30',
  log_retention_days: '1',
  log_clean_time: '03:00',
})

const forceOnline = ref(false)
const saving = ref(false)
const cleaning = ref(false)

// ============ 系统公告 ============
const noticeForm = reactive({ title: '', content: '', strong: false, link: '' })
const sendMode = ref<'now' | 'schedule'>('now')
const sendAt = ref('')
const publishedNotice = ref<NoticePayload | null>(null)
const pendingNotice = ref<PendingNotice | null>(null)
const noticeSaving = ref(false)
const noticeSending = ref(false)
const noticeWithdrawing = ref(false)
// 当前保持实时连接（SSE）的客户端数量，用于判断公告能否即时送达
const streamClients = ref(0)

// 预览标题：标题优先，无标题时取正文首个非空行（与客户端横幅一致）
const previewTitle = computed(
  () =>
    noticeForm.title.trim() ||
    noticeForm.content.split(/\r?\n/).find((s) => s.trim())?.trim() ||
    '公告标题',
)

function formatTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function applyNoticeState(state: NoticeState) {
  publishedNotice.value = state.notice_published ?? null
  pendingNotice.value = state.notice_pending_task ?? null
}

// 与后端 getOnlineWindowMinutes 保持一致：在线窗口 = 心跳间隔*60 + 宽限
const onlineWindowMin = computed(
  () => (Number(policy.heartbeat_interval_hours) || 6) * 60 + (Number(policy.online_threshold_minutes) || 30),
)

async function loadPolicy() {
  try {
    const data = await getConfig()
    policy.heartbeat_interval_hours = data.heartbeat_interval_hours ?? '6'
    policy.offline_grace_days = data.offline_grace_days ?? '7'
    policy.force_online_activate = data.force_online_activate ?? '0'
    policy.notice = data.notice ?? ''
    policy.online_threshold_minutes = data.online_threshold_minutes ?? '30'
    policy.log_retention_days = data.log_retention_days ?? '1'
    policy.log_clean_time = data.log_clean_time ?? '03:00'
    forceOnline.value = policy.force_online_activate === '1'

    noticeForm.title = data.notice_title ?? ''
    noticeForm.content = data.notice_content ?? ''
    noticeForm.strong = data.notice_strong === '1'
    noticeForm.link = data.notice_link ?? ''
    applyNoticeState(data)
    streamClients.value = data.notice_stream_clients ?? 0
    // 老数据迁移：只有已发布公告（历史 notice）时，回填到草稿便于继续编辑
    if (!noticeForm.title && !noticeForm.content && data.notice_published) {
      noticeForm.title = data.notice_published.title
      noticeForm.content = data.notice_published.content
      noticeForm.strong = data.notice_published.strong
      noticeForm.link = data.notice_published.link
    }
  } catch {
    // 拦截器已提示
  }
}

async function savePolicy() {
  saving.value = true
  try {
    await updateConfig({
      heartbeat_interval_hours: String(policy.heartbeat_interval_hours),
      force_online_activate: forceOnline.value ? '1' : '0',
      online_threshold_minutes: String(policy.online_threshold_minutes),
      log_retention_days: String(policy.log_retention_days),
      log_clean_time: policy.log_clean_time,
    })
    // 系统公告：保存设置后按所选发送方式立即生效（立即发送=马上推送，定时发送=到点自动推送）
    await updateConfig({
      notice_title: noticeForm.title,
      notice_content: noticeForm.content,
      notice_strong: noticeForm.strong ? '1' : '0',
      notice_link: noticeForm.link.trim(),
    })
    let noticeTip = ''
    if (!noticeContentEmpty()) {
      if (sendMode.value === 'now') {
        const res = await sendNotice(buildNoticeBody())
        applyNoticeState(res)
        noticeTip = `，${deliveredTip(res)}`
      } else {
        const ts = sendAt.value ? new Date(sendAt.value.replace(/-/g, '/')).getTime() : 0
        if (!ts || ts <= Date.now()) {
          noticeTip = '，公告已保存，请选择晚于当前时间的定时发送时间'
        } else {
          applyNoticeState(await scheduleNotice({ ...buildNoticeBody(), sendAt: new Date(ts).toISOString() }))
          noticeTip = `，公告将于 ${formatTime(ts)} 自动推送`
        }
      }
    }
    ElMessage.success(`系统设置已保存${noticeTip}`)
    await loadPolicy()
  } catch {
    // 拦截器已提示
  } finally {
    saving.value = false
  }
}

function buildNoticeBody() {
  return {
    title: noticeForm.title.trim(),
    content: noticeForm.content,
    strong: noticeForm.strong,
    link: noticeForm.link.trim(),
  }
}

function noticeContentEmpty(): boolean {
  return !noticeForm.title.trim() && !noticeForm.content.trim()
}

// 依据后端返回的真实送达连接数给出提示，避免无客户端在线时误报“已推送”
function deliveredTip(res: NoticeSendResult): string {
  const n = res.notice_delivered ?? 0
  return n > 0
    ? `公告已推送到 ${n} 个在线客户端`
    : '当前无客户端保持实时连接，公告将在客户端下次心跳时同步'
}

async function handleSaveDraft() {
  noticeSaving.value = true
  try {
    await updateConfig({
      notice_title: noticeForm.title,
      notice_content: noticeForm.content,
      notice_strong: noticeForm.strong ? '1' : '0',
      notice_link: noticeForm.link.trim(),
    })
    ElMessage.success('公告草稿已保存（未推送到客户端）')
  } catch {
    // 拦截器已提示
  } finally {
    noticeSaving.value = false
  }
}

async function handleSendNotice() {
  if (noticeContentEmpty()) {
    ElMessage.warning('请填写公告标题或内容')
    return
  }
  noticeSending.value = true
  try {
    const res = await sendNotice(buildNoticeBody())
    applyNoticeState(res)
    ElMessage.success(deliveredTip(res))
  } catch {
    // 拦截器已提示
  } finally {
    noticeSending.value = false
  }
}

async function handleScheduleNotice() {
  if (noticeContentEmpty()) {
    ElMessage.warning('请填写公告标题或内容')
    return
  }
  if (!sendAt.value) {
    ElMessage.warning('请选择发送时间')
    return
  }
  const ts = new Date(sendAt.value.replace(/-/g, '/')).getTime()
  if (!ts || ts <= Date.now()) {
    ElMessage.warning('发送时间需晚于当前时间')
    return
  }
  noticeSending.value = true
  try {
    applyNoticeState(await scheduleNotice({ ...buildNoticeBody(), sendAt: new Date(ts).toISOString() }))
    ElMessage.success(`已设置定时发送：${formatTime(ts)}`)
  } catch {
    // 拦截器已提示
  } finally {
    noticeSending.value = false
  }
}

async function handleCancelSchedule() {
  try {
    await ElMessageBox.confirm('确定取消已设置的定时发送吗？', '取消定时发送', {
      type: 'warning',
      confirmButtonText: '取消定时',
      cancelButtonText: '返回',
    })
  } catch {
    return
  }
  try {
    applyNoticeState(await cancelScheduledNotice())
    ElMessage.success('已取消定时发送')
  } catch {
    // 拦截器已提示
  }
}

async function handleWithdraw() {
  try {
    await ElMessageBox.confirm('撤销后所有客户端将立即隐藏公告栏，确定撤销吗？', '撤销公告', {
      type: 'warning',
      confirmButtonText: '撤销',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  noticeWithdrawing.value = true
  try {
    applyNoticeState(await withdrawNotice())
    ElMessage.success('公告已撤销')
  } catch {
    // 拦截器已提示
  } finally {
    noticeWithdrawing.value = false
  }
}

// ============ 操作日志立即清理 ============
async function handleCleanLogs() {
  const days = Number(policy.log_retention_days) || 1
  try {
    await ElMessageBox.confirm(`将删除超过 ${days} 天的所有操作日志，确定立即清理吗？`, '清理过期日志', {
      type: 'warning',
      confirmButtonText: '立即清理',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户取消
  }
  cleaning.value = true
  try {
    const res = await cleanLogs()
    ElMessage.success(`已清理 ${res.operationLogs} 条操作日志、${res.heartbeats} 条心跳日志`)
  } catch {
    // 拦截器已提示
  } finally {
    cleaning.value = false
  }
}

// ============ 邮件发件 / 短信 / 通知渠道 ============
const CATEGORY_LABELS: Record<string, string> = { account: '账号', license: '授权', system: '系统' }
const CHANNEL_META: Record<string, { label: string; type: 'info' | 'success' | 'warning' | 'danger' }> = {
  SYSTEM: { label: '站内信', type: 'info' },
  EMAIL: { label: '邮件', type: 'success' },
  SMS: { label: '短信', type: 'warning' },
  DINGTALK: { label: '钉钉', type: 'danger' },
  WECOM: { label: '企业微信', type: 'success' },
}

const mailForm = reactive({
  smtp_host: '',
  smtp_port: '465',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  mail_from_name: 'eBox 授权服务',
  mail_site_url: '',
})
const mailEnabled = ref(false)
const smtpPassSet = ref(false)
const mailSaving = ref(false)
const mailTesting = ref(false)
const mailTestTo = ref('')

const smsForm = reactive({
  sms_access_key_id: '',
  sms_access_key_secret: '',
  sms_sign_name: '',
  sms_region: 'cn-hangzhou',
  sms_tpl_verify_code: '',
  sms_admin_phone: '',
})
const smsEnabled = ref(false)
const smsSecretSet = ref(false)
const smsSaving = ref(false)
const smsTesting = ref(false)
const smsConnTesting = ref(false)
const smsTestPhone = ref('')

const notifyForm = reactive({
  notify_dingtalk_url: '',
  notify_dingtalk_secret: '',
  notify_wecom_url: '',
  notify_email_to: '',
  notify_sms_phone: '',
})
const notifyGlobalEnabled = ref(false)
const dingtalkSecretSet = ref(false)
const notifySaving = ref(false)

async function loadNotifyConfig() {
  try {
    const data = await getNotifyConfig()
    mailForm.smtp_host = data.smtp_host || ''
    mailForm.smtp_port = data.smtp_port || '465'
    mailForm.smtp_user = data.smtp_user || ''
    mailForm.smtp_pass = ''
    mailForm.smtp_from = data.smtp_from || ''
    mailForm.mail_from_name = data.mail_from_name || 'eBox 授权服务'
    mailForm.mail_site_url = data.mail_site_url || ''
    mailEnabled.value = data.mail_enabled === '1'
    smtpPassSet.value = data.smtp_pass === '__SET__'

    smsForm.sms_access_key_id = data.sms_access_key_id || ''
    smsForm.sms_access_key_secret = ''
    smsForm.sms_sign_name = data.sms_sign_name || ''
    smsForm.sms_region = data.sms_region || 'cn-hangzhou'
    smsForm.sms_tpl_verify_code = data.sms_tpl_verify_code || ''
    smsForm.sms_admin_phone = data.sms_admin_phone || ''
    smsEnabled.value = data.sms_enabled === '1'
    smsSecretSet.value = data.sms_access_key_secret === '__SET__'

    notifyForm.notify_dingtalk_url = data.notify_dingtalk_url || ''
    notifyForm.notify_dingtalk_secret = ''
    notifyForm.notify_wecom_url = data.notify_wecom_url || ''
    notifyForm.notify_email_to = data.notify_email_to || ''
    notifyForm.notify_sms_phone = data.notify_sms_phone || ''
    notifyGlobalEnabled.value = data.notify_global_enabled === '1'
    dingtalkSecretSet.value = data.notify_dingtalk_secret === '__SET__'
  } catch {
    // 拦截器已提示
  }
}

async function saveMailConfig() {
  mailSaving.value = true
  try {
    await updateNotifyConfig({
      mail_enabled: mailEnabled.value ? '1' : '0',
      smtp_host: mailForm.smtp_host.trim(),
      smtp_port: mailForm.smtp_port.trim() || '465',
      smtp_user: mailForm.smtp_user.trim(),
      smtp_pass: mailForm.smtp_pass,
      smtp_from: mailForm.smtp_from.trim(),
      mail_from_name: mailForm.mail_from_name.trim(),
      mail_site_url: mailForm.mail_site_url.trim(),
    })
    ElMessage.success('邮件配置已保存')
    await loadNotifyConfig()
  } catch {
    // 拦截器已提示
  } finally {
    mailSaving.value = false
  }
}

async function handleTestMail() {
  const to = mailTestTo.value.trim()
  if (!to) {
    ElMessage.warning('请填写测试收件人邮箱')
    return
  }
  mailTesting.value = true
  try {
    await testMail(to)
    ElMessage.success('测试邮件已发送，请查收')
  } catch {
    // 拦截器已提示
  } finally {
    mailTesting.value = false
  }
}

async function saveSmsConfig() {
  smsSaving.value = true
  try {
    await updateNotifyConfig({
      sms_enabled: smsEnabled.value ? '1' : '0',
      sms_provider: 'aliyun',
      sms_access_key_id: smsForm.sms_access_key_id.trim(),
      sms_access_key_secret: smsForm.sms_access_key_secret,
      sms_sign_name: smsForm.sms_sign_name.trim(),
      sms_region: smsForm.sms_region,
      sms_tpl_verify_code: smsForm.sms_tpl_verify_code.trim(),
      sms_admin_phone: smsForm.sms_admin_phone.trim(),
    })
    ElMessage.success('短信配置已保存')
    await loadNotifyConfig()
  } catch {
    // 拦截器已提示
  } finally {
    smsSaving.value = false
  }
}

async function handleTestSmsConnection() {
  smsConnTesting.value = true
  try {
    const res = await testSmsConnection()
    ElMessage.success(`阿里云连通正常（模板数 ${res.total}）`)
  } catch {
    // 拦截器已提示
  } finally {
    smsConnTesting.value = false
  }
}

async function handleTestSms() {
  const phone = smsTestPhone.value.trim()
  if (!phone) {
    ElMessage.warning('请填写测试手机号')
    return
  }
  smsTesting.value = true
  try {
    await testSms({ phone, template_code: smsForm.sms_tpl_verify_code.trim() || undefined })
    ElMessage.success('测试短信已提交，请查收')
  } catch {
    // 拦截器已提示
  } finally {
    smsTesting.value = false
  }
}

async function saveNotifyConfig() {
  notifySaving.value = true
  try {
    await updateNotifyConfig({
      notify_global_enabled: notifyGlobalEnabled.value ? '1' : '0',
      notify_dingtalk_url: notifyForm.notify_dingtalk_url.trim(),
      notify_dingtalk_secret: notifyForm.notify_dingtalk_secret,
      notify_wecom_url: notifyForm.notify_wecom_url.trim(),
      notify_email_to: notifyForm.notify_email_to.trim(),
      notify_sms_phone: notifyForm.notify_sms_phone.trim(),
    })
    ElMessage.success('通知渠道已保存')
    await loadNotifyConfig()
  } catch {
    // 拦截器已提示
  } finally {
    notifySaving.value = false
  }
}

// ============ 消息模板 ============
const tplQuery = reactive({ page: 1, pageSize: 20, keyword: '', category: '' })
const tplList = ref<NotificationTemplateRow[]>([])
const tplTotal = ref(0)
const tplLoading = ref(false)

const tplDialogVisible = ref(false)
const tplSaving = ref(false)
const tplTesting = ref(false)
const tplTestResults = ref<NotifyChannelResult[]>([])
const tplForm = reactive({
  id: '',
  code: '',
  name: '',
  category: 'account',
  title: '',
  content: '',
  channels: ['SYSTEM'] as string[],
  sms_template_code: '',
  is_enabled: 1,
  auto_trigger: 1,
  sort_order: 0,
})

function channelList(raw: string): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
}

async function loadTemplates() {
  tplLoading.value = true
  try {
    const res = await getTemplates({
      page: tplQuery.page,
      pageSize: tplQuery.pageSize,
      keyword: tplQuery.keyword.trim(),
      category: tplQuery.category,
    })
    tplList.value = res.list
    tplTotal.value = res.total
  } catch {
    // 拦截器已提示
  } finally {
    tplLoading.value = false
  }
}

function searchTemplates() {
  tplQuery.page = 1
  loadTemplates()
}

function resetTplForm() {
  tplForm.id = ''
  tplForm.code = ''
  tplForm.name = ''
  tplForm.category = 'account'
  tplForm.title = ''
  tplForm.content = ''
  tplForm.channels = ['SYSTEM']
  tplForm.sms_template_code = ''
  tplForm.is_enabled = 1
  tplForm.auto_trigger = 1
  tplForm.sort_order = 0
  tplTestResults.value = []
}

function openTemplateDialog(row?: NotificationTemplateRow) {
  resetTplForm()
  if (row) {
    tplForm.id = row.id
    tplForm.code = row.code
    tplForm.name = row.name
    tplForm.category = row.category || ''
    tplForm.title = row.title || ''
    tplForm.content = row.content || ''
    tplForm.channels = channelList(row.channels)
    tplForm.sms_template_code = row.smsTemplateCode || ''
    tplForm.is_enabled = row.isEnabled
    tplForm.auto_trigger = row.autoTrigger
    tplForm.sort_order = row.sortOrder
  }
  tplDialogVisible.value = true
}

function openTestTemplate(row: NotificationTemplateRow) {
  openTemplateDialog(row)
  void handleTestTemplate()
}

async function handleTestTemplate() {
  if (!tplForm.id) {
    ElMessage.warning('请先保存模板后再测试发送')
    return
  }
  tplTesting.value = true
  tplTestResults.value = []
  try {
    const res = await testTemplate(tplForm.code)
    tplTestResults.value = res.items
  } catch {
    // 拦截器已提示
  } finally {
    tplTesting.value = false
  }
}

async function saveTemplate() {
  if (!tplForm.id && !/^[A-Z0-9_]{2,64}$/.test(tplForm.code.trim())) {
    ElMessage.warning('模板编码需为 2-64 位大写字母 / 数字 / 下划线')
    return
  }
  if (!tplForm.name.trim()) {
    ElMessage.warning('请填写模板名称')
    return
  }
  tplSaving.value = true
  try {
    const payload = {
      name: tplForm.name.trim(),
      category: tplForm.category,
      title: tplForm.title.trim(),
      content: tplForm.content,
      channels: tplForm.channels,
      sms_template_code: tplForm.sms_template_code.trim(),
      is_enabled: tplForm.is_enabled,
      auto_trigger: tplForm.auto_trigger,
      sort_order: tplForm.sort_order,
    }
    if (tplForm.id) {
      await updateTemplate(tplForm.id, payload)
      ElMessage.success('模板已保存')
    } else {
      await createTemplate({ ...payload, code: tplForm.code.trim().toUpperCase() })
      ElMessage.success('模板已创建')
    }
    tplDialogVisible.value = false
    await loadTemplates()
  } catch {
    // 拦截器已提示
  } finally {
    tplSaving.value = false
  }
}

async function changeTemplateSwitch(row: NotificationTemplateRow, field: 'isEnabled' | 'autoTrigger') {
  try {
    await updateTemplate(
      row.id,
      field === 'isEnabled' ? { is_enabled: row.isEnabled } : { auto_trigger: row.autoTrigger },
    )
    ElMessage.success('模板状态已更新')
  } catch {
    await loadTemplates()
  }
}

// ============ 修改密码 ============
const store = useUserStore()
const pwdFormRef = ref<FormInstance>()
const pwdSaving = ref(false)
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' })

const pwdRules: FormRules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '新密码至少 6 位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_r, v, cb) => {
        if (v !== pwdForm.newPassword) cb(new Error('两次输入的密码不一致'))
        else cb()
      },
      trigger: 'blur',
    },
  ],
}

async function submitPassword() {
  if (!pwdFormRef.value) return
  const valid = await pwdFormRef.value.validate().catch(() => false)
  if (!valid) return
  pwdSaving.value = true
  try {
    await changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword })
    ElMessage.success('密码修改成功，请重新登录')
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirm = ''
    store.logout()
    // 跳转登录
    window.location.href = '/login'
  } catch {
    // 拦截器已提示
  } finally {
    pwdSaving.value = false
  }
}

onMounted(() => {
  loadPolicy()
  loadNotifyConfig()
  loadTemplates()
})
</script>

<style scoped lang="scss">
.settings-card {
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  min-height: 480px;

  :deep(.el-tabs__header) {
    margin-bottom: 0;
    padding: 0 20px;
    border-bottom: 1px solid #f0f2f7;
  }
}

.tab-body {
  padding: 24px 32px 32px;
}

.form-item {
  .form-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-main);
    margin-bottom: 12px;
  }

  .hint {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-secondary);
    margin-left: 10px;
  }

  .clean-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;

    .clean-label {
      font-size: 13px;
      color: var(--text-main);
    }
  }

  .notice-editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 480px;
    max-width: 100%;
  }

  .notice-status {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;

    .notice-status-text {
      font-size: 12px;
      color: var(--text-secondary);
    }
  }

  .notice-options {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 12px;
  }

  .notice-option-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-main);
    min-width: 60px;
  }

  .notice-preview-wrap {
    margin-top: 16px;
  }

  .notice-preview {
    display: flex;
    align-items: center;
    gap: 10px;
    box-sizing: border-box;
    width: 480px;
    max-width: 100%;
    margin-top: 8px;
    padding: 10px 14px;
    border: 1px solid #ffcc80;
    border-radius: 8px;
    background: #fff8e6;
    color: #d32f2f;

    .np-tag {
      flex: none;
      padding: 1px 8px;
      border: 1px solid rgba(211, 47, 47, 0.35);
      border-radius: 10px;
      font-size: 12px;
      color: #d32f2f;
    }

    .np-text {
      flex: 1;
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      font-size: 13px;
      line-height: 20px;
      word-break: break-all;
    }

    .np-action {
      flex: none;
      font-size: 12px;
      opacity: 0.85;
    }

    // 强提醒：与客户端一致的深红底 + 白字加粗
    &.strong {
      border-color: #8e1b12;
      background: #8e1b12;
      color: #ffffff;

      .np-tag {
        border-color: rgba(255, 255, 255, 0.4);
        background: rgba(255, 255, 255, 0.16);
        color: #ffffff;
      }

      .np-text {
        font-weight: 700;
      }
    }
  }

  .notice-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 16px;
  }

  .form-grid {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 100%;
  }

  .grid-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .grid-label {
    width: 128px;
    flex: none;
    font-size: 13px;
    color: var(--text-main);
  }
}

.hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: 10px;
}

.text-secondary {
  color: var(--text-secondary);
}

.sub-card {
  box-sizing: border-box;
  padding: 20px 24px;
  margin-bottom: 20px;
  border: 1px solid #f0f2f7;
  border-radius: 8px;
  background: #fff;

  &:last-child {
    margin-bottom: 0;
  }

  .sub-title {
    margin-bottom: 16px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-main);
  }
}

.tpl-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.tpl-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.test-results {
  max-height: 200px;
  overflow-y: auto;
  padding: 12px;
  border-radius: 6px;
  background: #f7f8fc;

  .test-results-title {
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-main);
  }

  .test-result-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  .test-result-text {
    font-size: 12px;
    color: var(--text-secondary);
    word-break: break-all;
  }
}
</style>
