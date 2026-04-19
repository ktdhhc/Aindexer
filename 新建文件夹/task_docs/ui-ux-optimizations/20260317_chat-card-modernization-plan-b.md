# Chat Card Modernization - Plan B

## Goal

在保持简洁的前提下，为 Chat V0 卡片引入更现代、更有辨识度的视觉风格。

## Chosen Direction

- 微渐变外层卡片
- 输入区内描边
- 胶囊发送按钮
- 去掉消息区和会话区的子卡片感
- 改为用线条分隔内部结构，增强整体性

## Visual Principles

- 外层统一，内层克制
- 用极浅渐变代替纯白底
- 用分隔线代替盒中盒
- 只保留少量品牌色点缀
- 所有交互反馈保持轻量

## Concrete Changes

### Outer Card

- Chat 卡片使用更干净的浅色渐变背景
- 圆角收敛到更利落的层级
- 阴影减薄，避免厚重玻璃感
- 保留轻微描边，增强边界清晰度

### Header

- 顶部保留标题、模型选择、测试索引信息
- 去掉头部的独立浮层感
- 只用一条底部分隔线与主体分开

### Session Column

- 移除会话区背景卡片、边框卡片感
- 仅保留右侧分隔线
- 会话项不再使用整块卡片容器
- 当前会话使用左侧高亮线和极浅底色强调

### Message Area

- 移除消息窗口外层卡片边框与底色
- 保留消息气泡本身，但整体容器透明化
- 通过与输入区之间的分隔线维持结构秩序

### Composer

- 输入区改成一体式容器
- 外层使用 1px 内描边视觉
- 聚焦时仅做轻微边框提亮与光晕
- 发送按钮做成胶囊形，尺寸更精致

## Accent Strategy

品牌色仅用于以下位置：

- 发送按钮背景
- 输入区聚焦描边和光晕
- 当前会话左侧高亮条

## Dark Theme Notes

- 维持同样的线条分隔逻辑
- 渐变改为更低对比度的深色层次
- 光晕透明度降低，避免暗色模式刺眼

## Implementation Scope

主要修改文件：`backend/frontend/index.html`

重点调整样式：

- `.chat-v0-section`
- `.chat-v0-section .section-header`
- `.chat-v0-layout`
- `.chat-v0-session-panel`
- `.chat-v0-session-item`
- `.chat-v0-messages`
- `.chat-v0-composer-inner`
- `.chat-v0-send`

## Expected Result

- Chat 卡片不再像多个小卡片拼在一起
- 左侧会话栏与右侧聊天主体形成统一大面
- 整体更轻、更利落、更现代
- 风格有特点，但不会显得花哨
