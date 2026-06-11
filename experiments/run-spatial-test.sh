#!/bin/bash
set -e

SCENE="/d/测试/1/assets/images/scenes/3fee767e-feec-41bd-82c7-dd19da063135_1780923952981_0.png"
CHAR="/d/测试/1/assets/images/characters/23b3aae4-7efb-4e7f-8f11-ee98326d8217_1780923952132_0.png"
FFMPEG="C:/Users/Administrator/autodrama/resources/ffmpeg/ffmpeg.exe"
OUTDIR="C:/Users/Administrator/autodrama/experiments/output"

# Get scene dimensions
echo "=== Creating layout images ==="

# Layout A: scene + red semi-transparent box at target position
"$FFMPEG" -y -i "$SCENE" \
  -vf "drawbox=x=iw*0.3:y=ih*0.2:w=iw*0.25:h=ih*0.55:color=red@0.4:t=fill,drawtext=text='STAND HERE':x=iw*0.35:y=ih*0.15:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5" \
  "$OUTDIR/layout_A_red_box.png" 2>/dev/null
echo "Layout A (red box): $OUTDIR/layout_A_red_box.png"

# Layout B: scene + character silhouette outline (approximate)
"$FFMPEG" -y -i "$SCENE" -i "$CHAR" \
  -filter_complex "[1:v]scale=iw*0.3:-1,format=rgba,colorchannelmixer=aa=0.4[layer];[0:v][layer]overlay=x=W*0.35:y=H*0.2" \
  "$OUTDIR/layout_B_silhouette.png" 2>/dev/null
echo "Layout B (semi-transparent character): $OUTDIR/layout_B_silhouette.png"

# Layout C: scene + full character image placed at target position
"$FFMPEG" -y -i "$SCENE" -i "$CHAR" \
  -filter_complex "[1:v]scale=iw*0.4:-1[layer];[0:v][layer]overlay=x=W*0.33:y=H*0.15" \
  "$OUTDIR/layout_C_ghost.png" 2>/dev/null
echo "Layout C (character overlay): $OUTDIR/layout_C_ghost.png"

echo ""
echo "=== Layout images created ==="
echo "Now running API test with these layout images as img2img references..."
