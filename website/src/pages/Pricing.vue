<template>
  <div class="pricing">
    <section class="page-hero">
      <div class="container">
        <h1 class="page-title">定价方案</h1>
        <p class="page-sub">
          从个人多开到团队协作，按需要选择版本；卡密绑定账号，换机、重装登录即可恢复权益。
        </p>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="grid grid-3 plan-grid">
          <div v-for="plan in plans" :key="plan.name" class="card plan-card" :class="{ featured: plan.featured }">
            <span v-if="plan.featured" class="plan-badge">团队首选</span>
            <h2 class="plan-name">{{ plan.name }}</h2>
            <p class="plan-desc">{{ plan.desc }}</p>
            <div class="plan-price">
              <span class="plan-num">{{ plan.price }}</span>
              <span class="plan-unit">{{ plan.unit }}</span>
            </div>
            <p class="plan-meta">{{ plan.meta }}</p>
            <ul class="plan-features">
              <li v-for="item in plan.features" :key="item">
                <span class="plan-check">✓</span>{{ item }}
              </li>
            </ul>
            <a
              v-if="plan.external && purchaseUrl"
              class="btn btn-lg plan-btn"
              :class="plan.featured ? 'btn-primary' : 'btn-ghost'"
              :href="purchaseUrl"
              target="_blank"
              rel="noopener"
              @click="track('buy')"
            >
              {{ plan.cta }}
            </a>
            <RouterLink
              v-else
              class="btn btn-lg plan-btn"
              :class="plan.featured ? 'btn-primary' : 'btn-ghost'"
              :to="plan.to === 'purchase' ? '/contact' : plan.to"
            >
              {{ plan.cta }}
            </RouterLink>
          </div>
        </div>
        <p class="price-note">
          以上为月卡价格，另有季卡、年卡与永久授权；实际价格与活动以商城商品页为准。
        </p>
      </div>
    </section>

    <section class="section section-soft">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">权益对比</h2>
          <p class="section-sub">企业版按席位授权，默认 10 席（含管理员），超出部分用扩容码按需加购。</p>
        </div>
        <div class="table-wrap">
          <table class="price-table">
            <thead>
              <tr>
                <th>能力</th>
                <th>普通版</th>
                <th>高级版</th>
                <th class="highlight">企业版（管理员）</th>
                <th>企业成员</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in entitlementRows" :key="row.name">
                <td class="row-name">{{ row.name }}</td>
                <td>{{ row.normal }}</td>
                <td>{{ row.pro }}</td>
                <td class="highlight">{{ row.enterprise }}</td>
                <td>{{ row.member }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">升级码与扩容码</h2>
          <p class="section-sub">已有卡密也能按需补齐能力，不用重新买一张新卡。</p>
        </div>
        <div class="grid grid-2 pack-grid">
          <div class="card pack-card">
            <div class="pack-head">
              <h3 class="pack-title">升级码</h3>
              <span class="tag">个人普通 → 个人高级</span>
            </div>
            <p class="pack-desc">只提升版本等级，时长与到期日保持不变；不可逆、不可回退。</p>
            <ul class="pack-list">
              <li v-for="item in upgradePacks" :key="item.card">
                <span>{{ item.card }}</span>
                <strong>{{ item.price }}</strong>
                <em>{{ item.note }}</em>
              </li>
            </ul>
            <p class="pack-tip">剩余时长不足 1/3 时，直接购买高级版新卡更划算。</p>
          </div>
          <div class="card pack-card">
            <div class="pack-head">
              <h3 class="pack-title">扩容码</h3>
              <span class="tag">企业版加席位</span>
            </div>
            <p class="pack-desc">席位只增不减，有效期跟随企业主卡；永久企业卡不支持扩容。</p>
            <ul class="pack-list">
              <li v-for="item in seatPacks" :key="item.seats">
                <span>{{ item.seats }}</span>
                <strong>{{ item.price }}</strong>
                <em>{{ item.unit }}</em>
              </li>
            </ul>
            <p class="pack-tip">席位含管理员：10 席 = 管理员 1 人 + 成员 9 人。</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section section-soft">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">购买前常见问题</h2>
        </div>
        <div class="faq-list">
          <div v-for="item in pricingFaqs" :key="item.q" class="faq-item">
            <h3 class="faq-q">{{ item.q }}</h3>
            <p class="faq-a">{{ item.a }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container center">
        <h2 class="section-title">不确定选哪个版本？</h2>
        <p class="section-sub">告诉我们账号数量与使用场景，帮你算清席位和 IP 需求。</p>
        <div class="cta-actions">
          <RouterLink class="btn btn-primary btn-lg" to="/contact">联系咨询</RouterLink>
          <RouterLink class="btn btn-ghost btn-lg" to="/docs">查看使用手册</RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { track } from '@/api'
import { useSite } from '@/composables/useSite'
import { usePageHead } from '@/composables/usePageHead'
import { entitlementRows, plans, pricingFaqs, seatPacks, upgradePacks } from '@/data/pricing'

const { purchaseUrl } = useSite()
usePageHead(
  '定价方案_个人版与企业版',
  'eBox 定价：普通版 9.9 元起，高级版 29.9 元/月，企业版 299.9 元起含 10 个席位；支持升级码与席位扩容码。',
)
</script>

<style scoped>
.page-hero {
  padding: 64px 0 20px;
  background: linear-gradient(160deg, #eef4ff 0%, #ffffff 70%);
  text-align: center;
}

.page-title {
  font-size: 40px;
  letter-spacing: -1px;
}

.page-sub {
  margin: 16px auto 0;
  max-width: 720px;
  color: var(--text-2);
  font-size: 17px;
}

.plan-grid {
  align-items: stretch;
}

.plan-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 30px 26px;
}

.plan-card.featured {
  border-color: var(--primary-color);
  box-shadow: 0 14px 36px rgba(58, 122, 254, 0.18);
}

.plan-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--primary-color);
  color: #fff;
  font-size: 12px;
}

.plan-name {
  font-size: 22px;
}

.plan-desc {
  margin-top: 8px;
  min-height: 48px;
  color: var(--text-2);
  font-size: 14px;
}

.plan-price {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 18px;
}

.plan-num {
  font-size: 44px;
  font-weight: 700;
  line-height: 1;
  color: var(--primary-color);
  letter-spacing: -1px;
}

.plan-unit {
  color: var(--text-3);
  font-size: 14px;
}

.plan-meta {
  margin-top: 10px;
  color: var(--text-3);
  font-size: 12.5px;
}

.plan-features {
  flex: 1;
  margin: 22px 0 24px;
  padding-top: 18px;
  border-top: 1px dashed var(--border);
}

.plan-features li {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--text-2);
  font-size: 14px;
}

.plan-check {
  color: var(--primary-color);
  font-weight: 700;
}

.plan-btn {
  width: 100%;
}

.price-note {
  margin-top: 20px;
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
}

.table-wrap {
  overflow-x: auto;
}

.price-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  font-size: 14px;
}

.price-table th,
.price-table td {
  padding: 13px 14px;
  text-align: center;
  border-bottom: 1px solid var(--border);
}

.price-table thead th {
  background: var(--bg-soft);
  color: var(--text-1);
  font-size: 13.5px;
}

.price-table tbody tr:last-child td {
  border-bottom: 0;
}

.price-table .row-name {
  text-align: left;
  color: var(--text-2);
}

.price-table .highlight {
  background: var(--primary-light);
  color: var(--primary-dark);
  font-weight: 600;
}

.price-table tbody tr:last-child .highlight {
  font-weight: 700;
}

.pack-card {
  padding: 26px;
}

.pack-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pack-title {
  font-size: 20px;
}

.pack-desc {
  margin-top: 12px;
  color: var(--text-2);
  font-size: 14px;
}

.pack-list {
  margin-top: 18px;
  border-top: 1px dashed var(--border);
}

.pack-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px dashed var(--border);
  font-size: 14px;
  color: var(--text-2);
}

.pack-list strong {
  color: var(--text-1);
}

.pack-list em {
  margin-left: auto;
  color: var(--text-3);
  font-size: 12.5px;
  font-style: normal;
}

.pack-tip {
  margin-top: 14px;
  color: var(--text-3);
  font-size: 12.5px;
}

.faq-list {
  max-width: 820px;
  margin: 0 auto;
}

.faq-item {
  padding: 20px 24px;
  margin-bottom: 14px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.faq-q {
  font-size: 16px;
}

.faq-a {
  margin-top: 8px;
  color: var(--text-2);
  font-size: 14px;
}

.cta-actions {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin-top: 26px;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .page-title {
    font-size: 30px;
  }
  .plan-desc {
    min-height: auto;
  }
}
</style>
