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

// 🔥 مطور ومحسن لقنص روابط m3u8 بأشكالها المختلفة (العادية والمشفرة والهروبية)
function findM3u8InSource(htmlContent) {
    if (!htmlContent) return null;
    
    // 1. تعبير نمطي قوي للبحث عن روابط m3u8 الصريحة والمخفية
    const m3u8Regex = /(https?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_\+.~#?&//=]*\.m3u8[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/i;
    let match = htmlContent.match(m3u8Regex);
    
    if (match) {
        return match[1].replace(/\\/g, ''); // تنظيف الروابط الهروبية الناتجة عن الـ JSON أو الجافا سكريبت
    }

    // 2. البحث عن روابط m3u8 التي تحتوي على جودات مدمجة (مثل المصادر المقسمة داخل النص)
    const alternativeRegex = /"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/i;
    match = htmlContent.match(alternativeRegex);
    if (match) {
        return match[1].replace(/\\/g, '');
    }

    return null;
}

// ==================== استخراج سيرفرات المشاهدة وروابط m3u8 ====================
async function extractWatchServers(watchUrl) {
    try {
        console.log(`   👁️ جاري استخراج جميع سيرفرات المشاهدة من الصفحة...`);
        const html = await fetchPage(watchUrl);
        if (!html) return [];
        
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const servers = [];
        
        // البحث عن قائمة السيرفرات التي قدمتها
        const serverItems = doc.querySelectorAll('.watch--servers--list ul li.server--item');
        
        if (serverItems.length > 0) {
            console.log(`   🔍 تم العثور على أزرار لـ ${serverItems.length} سيرفر، جاري فحصها...`);
            
            // البحث عن الـ iframe النشط حالياً في الصفحة
            const activeIframeElement = doc.querySelector('iframe[src*="embed"], iframe[src*="video"], iframe[src*="player"]');
            const activeIframeSrc = activeIframeElement ? activeIframeElement.src : null;

            for (let i = 0; i < serverItems.length; i++) {
                const item = serverItems[i];
                const serverName = cleanText(item.querySelector('span')?.textContent) || `سيرفر ${i + 1}`;
                const dataId = item.getAttribute('data-id');
                const dataServer = item.getAttribute('data-server');
                const isActive = item.classList.contains('active');

                let iframeSrc = null;

                if (isActive && activeIframeSrc) {
                    // إذا كان السيرفر هو النشط، نأخذ رابط الـ iframe الموجود أصلاً في الصفحة
                    iframeSrc = activeIframeSrc;
                } else if (dataId && dataServer) {
                    // إذا كان السيرفر غير نشط، نحاكي طلب الجافا سكريبت (AJAX) لجلبه
                    try {
                        const ajaxUrl = `${BASE_URL}/wp-admin/admin-ajax.php`;
                        const params = new URLSearchParams();
                        
                        // Action الشائع في قوالب ووردبريس الخاصة بالأفلام
                        params.append('action', 'ts_get_server'); 
                        params.append('post_id', dataId);
                        params.append('server', dataServer);

                        const ajaxRes = await fetch(ajaxUrl, {
                            method: 'POST',
                            body: params,
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                                'X-Requested-With': 'XMLHttpRequest', // ضروري ليعتبره الموقع طلب AJAX
                                'Referer': watchUrl
                            }
                        });

                        if (ajaxRes.ok) {
                            const ajaxText = await ajaxRes.text();
                            // تحليل رد الـ AJAX حسب ما يرسله الموقع
                            if (ajaxText.includes('<iframe')) {
                                const ajaxDom = new JSDOM(ajaxText);
                                const iframe = ajaxDom.window.document.querySelector('iframe');
                                if (iframe && iframe.src) iframeSrc = iframe.src;
                            } else if (ajaxText.startsWith('http')) {
                                iframeSrc = ajaxText.replace(/\\/g, '').replace(/"/g, '').trim();
                            } else {
                                // محاولة التقاط أي رابط مضمن بصيغة JSON
                                const linkMatch = ajaxText.match(/(https?:\/\/[^"'\s]+embed[^"'\s]+)/);
                                if (linkMatch) iframeSrc = linkMatch[1];
                            }
                        }
                    } catch (ajaxError) {
                        console.log(`   ⚠️ فشل جلب السيرفر ${serverName} عبر الـ AJAX.`);
                    }
                }

                if (iframeSrc) {
                    if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
                    
                    let m3u8Url = iframeSrc.includes('.m3u8') ? iframeSrc : null;
                    
                    // البحث داخل الـ iframe إذا لم يكن الرابط m3u8 بشكل صريح
                    if (!m3u8Url) {
                        const serverHtml = await fetchPage(iframeSrc);
                        m3u8Url = findM3u8InSource(serverHtml);
                    }

                    servers.push({
                        name: serverName,
                        url: iframeSrc,
                        quality: "متعدد الجودات",
                        type: isActive ? "iframe_active" : "iframe_ajax",
                        m3u8Url: m3u8Url
                    });
                    
                    // تأخير 500 ملي ثانية لتفادي ضغط السيرفر أو الحظر
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        } 
        
        // مسار بديل (Fallback): إذا لم يجد أزرار السيرفرات يبحث عن أي iframe في الصفحة
        if (servers.length === 0) {
            const iframes = doc.querySelectorAll('iframe[src*="embed"], iframe[src*="video"], iframe[src*="player"], iframe[src*="vtt"], iframe[src*="ramp"]');
            for (let i = 0; i < iframes.length; i++) {
                let src = iframes[i].src;
                if (src) {
                    if (src.startsWith('//')) src = 'https:' + src;
                    let m3u8Url = src.includes('.m3u8') ? src : null;
                    
                    if (!m3u8Url) {
                        const serverHtml = await fetchPage(src);
                        m3u8Url = findM3u8InSource(serverHtml);
                    }

                    servers.push({
                        name: `سيرفر مشاهدة ${i + 1}`,
                        url: src,
                        quality: "متعدد الجودات",
                        type: "iframe_fallback",
                        m3u8Url: m3u8Url
                    });
                }
            }
        }
        
        console.log(`   ✅ تم العثور على ${servers.length} سيرفر مشاهدة.`);
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
    console.log(`\n🎬 [${position}/${total}] جاري استخراج تفاصيل: ${movie.title}...`);
    
    try {
        const html = await fetchPage(movie.url);
        if (!html) return null;
        
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        
        const shortLinkInput = doc.querySelector('input#shortlink');
        let shortLink = shortLinkInput ? shortLinkInput.value : movie.url;
        const movieId = extractMovieId(shortLink);
        
        const titleElement = doc.querySelector("h1.post-title a") || doc.querySelector(".post-title");
        const title = cleanText(titleElement?.textContent || movie.title);
        
        let image = doc.querySelector(".image img")?.src || doc.querySelector("img[src*='MV5B']")?.src;
        const imdbElement = doc.querySelector(".imdbR span, .imdbRating span");
        const imdbRating = imdbElement ? cleanText(imdbElement.textContent) : null;
        
        const storyElement = doc.querySelector(".story p, .entry-content p");
        const story = cleanText(storyElement?.textContent) || "غير متوفر";
        
        // استخراج تفاصيل الفيلم الجانبية
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

        const watchButton = doc.querySelector('a.watch, a[href*="/watch/"], .watch-btn a');
        const downloadButton = doc.querySelector('a.download, a[href*="/download/"], .download-btn a');
        
        let watchServers = [];
        if (watchButton && watchButton.href) {
            watchServers = await extractWatchServers(watchButton.href);
        } else {
            watchServers = await extractWatchServers(movie.url);
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
    console.log("🚀 بدء استخراج الصفحة الأولى فقط من قسم الأفلام...");
    const url = `${BASE_URL}/movies/`;
    
    const html = await fetchPage(url);
    if (!html) {
        console.log("❌ فشل جلب الصفحة الرئيسية للموقع.");
        return;
    }
    
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const initialMovies = [];
    
    // التقاط كتل الأفلام من الصفحة الأولى
    const movieElements = doc.querySelectorAll('.Small--Box a.recent--block');
    console.log(`✅ تم العثور على ${movieElements.length} فيلم في الصفحة الأولى.`);
    
    movieElements.forEach((element, i) => {
        let movieUrl = element.href;
        if (movieUrl) {
            if (movieUrl.startsWith('/')) movieUrl = BASE_URL + movieUrl;
            
            const titleElement = element.querySelector('h3.title') || element.querySelector('.title');
            const title
