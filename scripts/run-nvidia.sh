#!/usr/bin/env bash
# Run a command (e.g. the Tauri desktop build) on the NVIDIA dGPU via PRIME render offload.
# Only this process tree is affected — your everyday browser keeps its own GPU settings.
#
#   scripts/run-nvidia.sh npx tauri dev
#   scripts/run-nvidia.sh ./src-tauri/target/release/bunker-busters
set -euo pipefail

NV_RENDER=/dev/dri/by-path/pci-0000:01:00.0-render   # RTX 4050 (keyed on PCI address, not renderD number)

export __NV_PRIME_RENDER_OFFLOAD=1
export __GLX_VENDOR_LIBRARY_NAME=nvidia
export __VK_LAYER_NV_optimus=NVIDIA_only
export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json
# Default presentation path, measured on a hybrid Intel+RTX 4050 laptop under Hyprland:
#   native Wayland + dmabuf      → Wayland "Error 71" (compositor rejects NVIDIA buffers), crash
#   native Wayland, no dmabuf    → works, but frames are copied through RAM (~45 fps cap)
#   XWayland + dmabuf            → GBM allocation fails, no frames
#   XWayland, no dmabuf          → works at full refresh (144 fps)            ← default
# Set BB_WAYLAND=1 to try native Wayland instead.
if [ "${BB_WAYLAND:-0}" = "1" ]; then
  [ -e "$NV_RENDER" ] && export WEBKIT_WEB_RENDER_DEVICE_FILE="$(readlink -f "$NV_RENDER")"
  [ "${BB_NO_DMABUF:-0}" = "1" ] && export WEBKIT_DISABLE_DMABUF_RENDERER=1
else
  export GDK_BACKEND=x11
  export GDK_CORE_DEVICE_EVENTS=1  # GTK3 under XWayland otherwise never delivers mouse clicks
  export WEBKIT_DISABLE_DMABUF_RENDERER=1
fi

exec "$@"
