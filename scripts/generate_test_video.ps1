$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "storage/uploads" | Out-Null
ffmpeg -y -f lavfi -i "testsrc2=size=1280x720:rate=30" -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 45 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "storage/uploads/demo.mp4"

