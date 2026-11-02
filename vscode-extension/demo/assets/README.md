Viaalink brand assets for the demo film's cards and corner tab.

- `viaalink-wordmark.png` is `static/assets/logo-wordmark@2x.png` from the viaalink-website repo (red mark, navy letters, transparent).
- `viaalink-wordmark-tab.png` is that wordmark at 200 px on a 228×60 white tab:
  `ffmpeg -f lavfi -i color=c=white:s=228x60 -i viaalink-wordmark.png -filter_complex "[1:v]scale=200:-1[l];[0:v][l]overlay=(W-w)/2:(H-h)/2,format=rgb24" -frames:v 1 viaalink-wordmark-tab.png`
