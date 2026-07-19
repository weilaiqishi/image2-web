# Image2 Studio 宣传案例生成记录

本页记录 2026-07-19 宣传站重构使用的 8 个原创案例。全部通过用户配置的 OpenAI 兼容网关调用 `gpt-image-2` 生成；API Key、响应正文和请求标识未写入仓库。

这些记录同时作为宣传素材的可重复 MVP 用例。验收标准为：主体和构图符合提示、无第三方品牌、无水印、没有意外文字，且能在宣传站桌面与移动画廊中清楚展示。

| ID | 用例 | 请求规格 | WebP 输出 | 最终文件 |
| --- | --- | --- | --- | --- |
| CASE-MKT-01 | 雨夜时尚人物 | 1024x1280 / medium | 656x1280 | `site/images/cases/case-fashion.webp` |
| CASE-MKT-02 | 石墨音响产品摄影 | 1024x1024 / medium | 1254x1254 | `site/images/cases/case-product.webp` |
| CASE-MKT-03 | 午夜面馆餐饮纪实 | 1280x1024 / medium | 1280x853 | `site/images/cases/case-food.webp` |
| CASE-MKT-04 | 多设备创意工作台 UI | 1280x1024 / high | 1280x853 | `site/images/cases/case-ui.webp` |
| CASE-MKT-05 | 冷海悬崖建筑 | 1280x1024 / medium | 1280x853 | `site/images/cases/case-architecture.webp` |
| CASE-MKT-06 | 轨道舱工程师角色 | 1024x1280 / medium | 607x1280 | `site/images/cases/case-game.webp` |
| CASE-MKT-07 | 玻璃鲸档案馆插画 | 1024x1280 / medium | 853x1280 | `site/images/cases/case-illustration.webp` |
| CASE-MKT-08 | 凌晨列车四格分镜 | 1024x816 / low | 1280x853 | `site/images/cases/case-storyboard.webp` |

## CASE-MKT-01

```text
Use case: photorealistic-natural
Primary request: An original cinematic fashion portrait of a young East Asian creative director standing beneath a rain-slick concrete arcade at blue hour, charcoal technical jacket, natural skin texture, wet pavement reflections, editorial confidence.
Style/medium: Premium contemporary fashion editorial photography, restrained futuristic art direction.
Composition/framing: Vertical three-quarter portrait, subject offset slightly from center, shallow depth of field.
Lighting/mood: Cool cyan practical lights with one warm amber rim light, realistic rain reflections.
Constraints: Original person and wardrobe; no brands; no text; no logos; no watermark; realistic hands and facial anatomy.
```

## CASE-MKT-02

```text
Use case: product-mockup
Primary request: An original luxury product photograph of a sculptural matte graphite wireless speaker on a dark mineral plinth, precise machined vents and tactile controls, designed for a fictional premium audio brand.
Style/medium: High-end industrial design campaign photography.
Lighting/mood: Controlled studio strip lights with crisp cyan edge highlights and a soft amber reflection.
Constraints: No brand name; no readable text; no logos; no watermark; believable product construction.
```

## CASE-MKT-03

```text
Use case: photorealistic-natural
Primary request: An original evening food editorial scene inside a compact contemporary noodle bar, chef plating a vivid bowl at a stainless counter while two friends lean in, energetic but authentic neighborhood atmosphere.
Style/medium: Documentary restaurant campaign photography with polished color grading.
Lighting/mood: Warm task lights balanced by cool street light through the window.
Constraints: No restaurant branding; no readable text; no logos; no watermark; realistic food and hands.
```

## CASE-MKT-04

```text
Use case: ui-mockup
Primary request: An original mobile creative-planning application shown across one tablet and one phone on a matte black workbench, interface contains a dark image generation queue, reference thumbnails, clear controls and cyan status indicators.
Style/medium: Shippable professional product UI photographed as a premium device mockup, not concept art.
Constraints: Fictional interface; no known brand UI; use simple legible generic labels only; no logos; no watermark; practical layout.
```

## CASE-MKT-05

```text
Use case: stylized-concept
Primary request: An original architectural visualization of a cliffside creative retreat built from blackened timber and glass above a cold ocean, interior studio visible through the facade, dramatic but buildable geometry.
Style/medium: Photoreal architectural visualization with cinematic restraint.
Lighting/mood: Overcast dawn with warm interior pools of light and subtle mist.
Constraints: No impossible cantilevers; no people close-up; no text; no logos; no watermark.
```

## CASE-MKT-06

```text
Use case: stylized-concept
Primary request: An original tactical science-fiction character standing inside a weathered orbital maintenance bay, compact utility suit with modular tools, helmet held at the hip, grounded working-class future rather than superhero armor.
Style/medium: Cinematic game key art, industrial realism, highly detailed character design.
Constraints: Original character; no franchise references; no weapons; no text; no logos; no watermark; anatomically coherent hands.
```

## CASE-MKT-07

```text
Use case: illustration-story
Primary request: An original surreal editorial illustration of a translucent glass whale floating through a night archive filled with paper constellations, shelves bending gently into the distance.
Style/medium: Refined mixed-media editorial illustration, ink, cut paper and luminous glass rendering.
Constraints: No text; no logos; no watermark; sophisticated editorial tone; avoid childish cartoon styling.
```

## CASE-MKT-08

```text
Use case: illustration-story
Primary request: An original four-frame cinematic storyboard contact sheet of the same electric train arriving at the same foggy mountain platform before dawn: wide arrival, door detail, lone passenger silhouette, train leaving into mist.
Style/medium: Professional cinematic storyboard with four consistent photoreal film stills.
Composition/framing: Exact 2 by 2 equal panel grid, thin black gutters, coherent camera sequence.
Constraints: Exactly four panels; same train and platform in every panel; no captions; no text; no logos; no watermark.
```
