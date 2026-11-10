# CLUB JOIA 300 carousel

An Instagram-style carousel with 6 slides. Open `index.html` in any browser; nothing needs installing.

## Replacing a slide

1. Put your file in the `footage` folder and name it `slide_1`, `slide_2`, up to `slide_6`.
2. Delete the old file with the same number. For example, replace `slide_3.jpg` with `slide_3.mp4`.
3. Reload the page.

| Type | Accepted files |
|---|---|
| Video | `.mp4` `.webm` `.mov` `.m4v` |
| Image | `.jpg` `.jpeg` `.png` `.webp` `.gif` `.avif` |

- **File type:** each slide decides for itself whether it's an image or a video, based on the file it finds. If both exist for the same number, the video is used.
- **Best size:** 1080 × 1350 px (4:5 portrait, Instagram's post format). Other sizes are cropped to fill the frame.
- **Videos:** they play muted and loop while their slide is showing. Tap a video to pause it; the speaker button turns sound on.
- **iPhone:** for your own videos, use **.mp4** (H.264), which plays everywhere. The sample videos are `.webm`.

## Changing the text or the number of slides

At the bottom of `index.html`, edit `SETTINGS`: account name, location, caption, number of likes, and `slides`, the number of slides.

## How to use it

- Swipe or drag on a phone.
- On a computer, use the arrow buttons or the ← → keys.
- Double-tap to like.

## Putting it online

The carousel is a static website: plain files with no database or server software, so it runs on
**any** web hosting, including GoDaddy cPanel.

**GoDaddy / cPanel:**
1. cPanel → **File Manager** → open `public_html`.
2. Click **Upload** and upload `CJ300_Carousel.zip`, then right-click it → **Extract**.
3. It's live at `https://www.warnertgroup.com/carousel/`.

If you upload the files without the zip, keep the folders as they are: `index.html`, `.htaccess`, `assets/` and `footage/`. `.htaccess` is a hidden file; in File Manager, Settings → "Show hidden files".

**Changing a slide later:** upload the new `slide_N` file into `public_html/carousel/footage` and delete the old one. On a web server, file names are case-sensitive: `slide_1.jpg`, `Slide_1.jpg`, `slide_1.JPG` and `Slide_1.JPG` are all found, but other spellings such as `SLIDE_1.jpg` are not.

**Showing it inside another web page:**

```html
<iframe src="/carousel/" style="width:100%;max-width:480px;aspect-ratio:4/6.2;border:0" loading="lazy" title="CLUB JOIA 300"></iframe>
```
