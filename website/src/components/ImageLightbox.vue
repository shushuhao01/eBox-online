<template>
  <Teleport to="body">
    <div v-if="isOpen" class="image-lightbox" @click="close">
      <button class="ilb-close" aria-label="关闭" @click.stop="close">×</button>
      <button
        v-if="images.length > 1"
        class="ilb-nav prev"
        aria-label="上一张"
        @click.stop="step(-1)"
      >
        ‹
      </button>
      <img :src="images[index]" class="ilb-img" :alt="alt" @click.stop />
      <button
        v-if="images.length > 1"
        class="ilb-nav next"
        aria-label="下一张"
        @click.stop="step(1)"
      >
        ›
      </button>
      <div v-if="images.length > 1" class="ilb-count">{{ index + 1 }} / {{ images.length }}</div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'

/**
 * 通用图片放大查看组件（轮播图共用）
 * 用法：<ImageLightbox v-model:index="lightboxIndex" :images="images" />
 * index 为 -1 时关闭；支持 Esc 关闭、左右方向键切换、点击遮罩关闭。
 */
const props = withDefaults(
  defineProps<{
    images: string[]
    index: number
    alt?: string
  }>(),
  { alt: '' },
)

const emit = defineEmits<{ (e: 'update:index', value: number): void }>()

const isOpen = computed(() => props.index >= 0 && props.index < props.images.length)

function close() {
  emit('update:index', -1)
}

function step(delta: number) {
  const len = props.images.length
  if (len < 2) return
  emit('update:index', (props.index + delta + len) % len)
}

function onKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowLeft') step(-1)
  else if (e.key === 'ArrowRight') step(1)
}

// 放大时锁滚动，避免背景页面跟着滚
watch(isOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

onMounted(() => window.addEventListener('keydown', onKeydown))

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<style scoped>
.image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px;
  background: rgba(0, 0, 0, 0.88);
  cursor: zoom-out;
}

.ilb-img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  cursor: default;
}

.ilb-close,
.ilb-nav {
  position: absolute;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s ease;
}

.ilb-close:hover,
.ilb-nav:hover {
  background: rgba(255, 255, 255, 0.32);
}

.ilb-close {
  top: 20px;
  right: 24px;
  width: 42px;
  height: 42px;
  font-size: 26px;
  line-height: 1;
}

.ilb-nav {
  top: 50%;
  transform: translateY(-50%);
  width: 52px;
  height: 52px;
  padding-bottom: 4px;
  font-size: 34px;
  line-height: 1;
}

.ilb-nav.prev {
  left: 24px;
}

.ilb-nav.next {
  right: 24px;
}

.ilb-count {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.85);
  font-size: 14px;
  letter-spacing: 1px;
}

@media (max-width: 640px) {
  .image-lightbox {
    padding: 24px 12px;
  }

  .ilb-nav {
    width: 40px;
    height: 40px;
    font-size: 26px;
  }

  .ilb-nav.prev {
    left: 6px;
  }

  .ilb-nav.next {
    right: 6px;
  }
}
</style>
