import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// إعدادات المسارات
const MOVIES_DIR = path.join(__dirname, "movies");
const HOME_FILE = path.join(MOVIES_DIR, "Home.json");

// إنشاء مجلد movies إذا لم يكن موجوداً
if (!fs.existsSync(MOVIES_DIR)) {
    fs.mkdirSync(MOVIES_DIR, { recursive: true });
}

const BASE_URL = "https://topcinemaa.com";

// ==================== دوال المساعدة ====================
async function fetchPage(url) {
    try {
        console.log(`🌐 جاري جلب: ${url.substring(0, 60)}...`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
            'Referer': BASE_URL,
        };
        
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            console.log(`❌ فشل الجلب: ${response.status}`);
            return null;
        }
        
        return await response.text();
        
    } catch (error) {
        console.log(`❌ خطأ في الجلب: ${error.message}`);
        return null;
    }
}

function cleanText(text) {
    return text ? text.replace(/\s+/g, " ").trim() : "";
}

function extractMovieId(url) {
    try {
        const match = url.match(/[?&]p=(\d+)/);
        if (match && match[1]) return match[1];
        
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        const lastPart = pathParts[pathParts.length - 1];
        const numMatch = lastPart.match(/(\d+)$/);
        return numMatch ? numMatch[1] : `temp_${Date.now()}`;
    } catch {
        return `temp_${Date.now()}`;
    }
}

// دالة تفحص السورس (Network/HTML) لاستخراج رابط m3u8
function findM3u8InSource(htmlContent) {
    if (!htmlContent) return null;
    // تعبير نمطي للبحث عن روابط m3u8 داخل النصوص أو الجافاسكريبت المضمنة
    const m3u8Regex = /(https?[\s\S]*?\.m3u8[^\s"']*)/i;
    const match = htmlContent.match(m3u8Regex);
    if (match) {
        // تنظيف الرابط من الرموز الهروبية مثل \/ ليصبح رابطاً صالحاً
        return match[1].replace(/\\/g, '');
    }
    return null;
}

// ==================== استخراج سيرفرات المشاهدة وروابط m3u8 ====================
async function extractWatchServers(watchUrl) {
    try {
        console.log(`   👁️ جاري استخراج سيرفرات المشاهدة وفحص الـ Network...`);
        const html = await fetchPage(watchUrl);
        if (!html) return [];
        
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const servers = [];
        
        // 1. البحث في Meta Tags
        const metaTags = ['og:video:secure_url', 'og:video', 'twitter:player:stream', 'video'];
        metaTags.forEach(property => {
            const meta = doc.querySelector(`meta[property="${property}"]`) || doc.querySelector(`meta[name="${property}"]`);
            if (meta && meta.content) {
                servers.push({
                    name: "مشاهدة مباشرة",
                    url: meta.content,
                    quality: "متعدد الجودات",
                    type: "meta_stream",
                    m3u8Url: meta.content.includes('.m3u8') ? meta.content : null
                });
            }
        });
        
        // 2. البحث في الـ Iframes والـ Embeds ومحاولة فحص محتواها إذا كان بها روابط مباشرة
        const iframes = doc.querySelectorAll('iframe[src*="embed"], iframe[src*="video"], iframe[src*="player"], iframe[src*="vtt"]');
        for (let i = 0; i < iframes.length; i++) {
            const src = iframes[i].src;
            if (src) {
                let m3u8Url = src.includes('.m3u8') ? src : null;
                
                // إذا لم يكن الرابط مباشر، نقوم بعمل فحص سريع لصفحة السيرفر الداخلية (Network Response)
                if (!m3u8Url) {
                    const serverHtml = await fetchPage(src);
                    m3u8Url = findM3u8InSource(serverHtml);
                }

                servers.push({
                    name: `مشاهدة Iframe ${i + 1}`,
                    url: src,
                    quality: "متعدد الجودات",
                    type: "iframe",
                    m3u8Url: m3u8Url
                });
            }
        }
        
        // 3. فحص كود الصفحة بالكامل لاستخراج أي رابط m3u8 عام في الخلفية (شبيه بالـ Network Sniffer)
        const generalM3u8 = findM3u8InSource(html);
        if (generalM3u8 && servers.length > 0 && !servers[0].m3u8Url) {
            servers[0].m3u8Url = generalM3u8;
        }
        
        console.log(`   ✅ تم العثور على ${servers.length} سيرفر مشاهدة`);
        return servers;
        
    } catch (error) {
        console.log(`   ⚠️ خطأ في استخراج سيرفرات المشاهدة: ${error.message}`);
        return [];
    }
}

// ==================== استخراج سيرفرات التحميل ====================
async function extractDownloadServers(downloadUrl) {
    try {
        console.log(`   ⬇️ جاري استخراج سيرفرات التحميل...`);
        const html = await fetchPage(downloadUrl);
        if (!html) return [];
        
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const servers = [];
        
        // 1. سيرفرات proServer
        const proServers = doc.querySelectorAll('.proServer a.downloadsLink');
        proServers.forEach(server => {
            const nameElement = server.querySelector('.text p');
            const qualityElement = server.querySelector('.text span');
            servers.push({
                name: cleanText(nameElement?.textContent) || "VidTube",
                url: server.href,
                quality: cleanText(qualityElement?.textContent) || "متعدد الجودات",
                type: "pro_server"
            });
        });
        
        // 2. سيرفرات الجودات DownloadBlock
        const downloadBlocks = doc.querySelectorAll('.DownloadBlock');
        downloadBlocks.forEach(block => {
            const qualityElement = block.querySelector('.download-title span');
            const quality = qualityElement ? cleanText(qualityElement.textContent) : "1080p";
            
            const serverLinks = block.querySelectorAll('ul.download-items a.downloadsLink');
            serverLinks.forEach(link => {
                const nameElement = link.querySelector('.text p');
                servers.push({
                    name: cleanText(nameElement?.textContent) || quality,
                    url: link.href,
                    quality: quality,
                    type: "download_server"
                });
            });
        });
        
        // تصفية المكرر
        return servers.filter((server, index, self) => index === self.findIndex((s) => s.url === server.url));
        
    } catch (error) {
        console.log(`   ⚠️ خطأ في سيرفرات التحميل: ${error.message}`);
        return [];
    }
}

// ==================== استخراج التفاصيل الكاملة للفيلم ====================
async function fetchMovieDetails(movie, position, total) {
    console.log(`\n🎬 [${position}/${total}] جاري استخراج: ${movie.title}...`);
    
    try {
        const html = await fetchPage(movie.url);
        if (!html) return null;
        
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        
        const shortLinkInput = doc.querySelector('input#shortlink');
        let shortLink = shortLinkInput ? shortLinkInput.value : movie.url;
        const movieId = extractMovieId(shortLink);
        
        const titleElement = doc.querySelector("h1.post-title a");
        const title = cleanText(titleElement?.textContent || movie.title);
        
        let image = doc.querySelector(".image img")?.src || doc.querySelector("img[src*='MV5B']")?.src;
        const imdbElement = doc.querySelector(".imdbR span, .imdbRating span");
        const imdbRating = imdbElement ? cleanText(imdbElement.textContent) : null;
        
        const storyElement = doc.querySelector(".story p, .entry-content p");
        const story = cleanText(storyElement?.textContent) || "غير متوفر";
        
        // استخراج التفاصيل
        const details = {};
        const detailItems = doc.querySelectorAll("ul.RightTaxContent li, .post-details li, .movie-details li");
        
        detailItems.forEach(item => {
            const labelElement = item.querySelector("span, strong:first-child");
            if (labelElement) {
                let label = cleanText(labelElement.textContent).replace(":", "").trim();
                let value = cleanText(item.textContent.replace(labelElement.textContent, ""));
                const links = item.querySelectorAll("a");
                const linkTexts = links.length > 0 ? Array.from(links).map(a => cleanText(a.textContent)) : [];
                
                if (label.includes('قسم') || label.includes('التصنيف')) details["قسم الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('نوع')) details["نوع الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('جودة')) details["جودة الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('توقيت') || label.includes('مدة')) details["توقيت الفيلم"] = value;
                else if (label.includes('صدور') || label.includes('تاريخ')) details["موعد الصدور"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('دولة')) details["دولة الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('مخرج')) details["المخرجين"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('بطولة')) details["بطولة"] = linkTexts.length > 0 ? linkTexts : value.split(',');
            }
        });

        // روابط صفحات السيرفرات
        const watchButton = doc.querySelector('a.watch, a[href*="watch"], .watch-btn a');
        const downloadButton = doc.querySelector('a.download, a[href*="download"], .download-btn a');
        
        // استخراج السيرفرات الفعلية (وتتبع الـ m3u8)
        let watchServers = [];
        if (watchButton && watchButton.href) {
            watchServers = await extractWatchServers(watchButton.href);
        }
        
        let downloadServers = [];
        if (downloadButton && downloadButton.href) {
            downloadServers = await extractDownloadServers(downloadButton.href);
        }
        
        return {
            id: movieId,
            title: title,
            url: movie.url,
            shortLink: shortLink,
            image: image || null,
            imdbRating: imdbRating,
            story: story,
            details: details,
            watchServers: watchServers,
            downloadServers: downloadServers,
            scrapedAt: new Date().toISOString()
        };
        
    } catch (error) {
        console.log(` ❌ خطأ في تفاصيل الفيلم: ${error.message}`);
        return null;
    }
}

// ==================== الدالة الأساسية للتشغيل ====================
async function startScraping() {
    console.log("🚀 بدء استخراج الصفحة الأولى فقط...");
    const url = `${BASE_URL}/movies/`;
    
    const html = await fetchPage(url);
    if (!html) {
        console.log("❌ فشل جلب الصفحة الرئيسية للموقع.");
        return;
    }
    
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const initialMovies = [];
    
    const movieElements = doc.querySelectorAll('.Small--Box a.recent--block');
    console.log(`✅ تم العثور على ${movieElements.length} فيلم في الصفحة الأولى.`);
    
    movieElements.forEach((element, i) => {
        const movieUrl = element.href;
        if (movieUrl && movieUrl.includes(BASE_URL.replace('https://', ''))) {
            const titleElement = element.querySelector('h3.title');
            const title = cleanText(titleElement?.textContent || `فيلم ${i + 1}`);
            
            initialMovies.push({
                title: title,
                url: movieUrl
            });
        }
    });
    
    const finalMoviesList = [];
    
    // المرور على الأفلام واستخراج سيرفراتها ومحاكاة الـ Network لرابط الـ m3u8
    for (let i = 0; i < initialMovies.length; i++) {
        const movieDetails = await fetchMovieDetails(initialMovies[i], i + 1, initialMovies.length);
        if (movieDetails) {
            finalMoviesList.push(movieDetails);
        }
        // تأخير ثانية واحدة لتفادي الحظر
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // بناء وحفظ ملف Home.json النهائي
    const fileContent = {
        fileName: "Home.json",
        description: "أفلام الصفحة الأولى مع روابط البث المباشر m3u8 المستخرجة من الشبكة",
        totalMovies: finalMoviesList.length,
        lastUpdated: new Date().toISOString(),
        movies: finalMoviesList
    };
    
    fs.writeFileSync(HOME_FILE, JSON.stringify(fileContent, null, 2));
    console.log(`\n🏠 اكتملت العملية بنجاح! تم حفظ الملف في: ${HOME_FILE}`);
}

// تشغيل السكريبت
startScraping();
