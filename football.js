import axios from 'axios';
import fs from 'fs';

/**
 * دالة لاستخراج الرابط المباشر m3u8 من المشغل
 * تم تحديث الـ Referer ليتناسب مع الموقع الجديد
 */
async function getDirectStream(iframeUrl) {
    if (!iframeUrl) return "";
    
    const fullIframeUrl = iframeUrl.startsWith('//') ? `https:${iframeUrl}` : iframeUrl;

    try {
        const { data } = await axios.get(fullIframeUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.majed-koora.com/', // تم التحديث هنا
                'Accept': '*/*'
            },
            timeout: 10000 
        });

        // 1. البحث عن روابط m3u8 الصريحة
        const m3u8Regex = /https?[:\/\w\.-]+\.m3u8[^\s"']*/gi;
        let matches = data.match(m3u8Regex);

        if (matches && matches.length > 0) {
            return matches[0].replace(/\\/g, ''); 
        }

        // 2. البحث عن الروابط داخل سمة "source" في المشغل
        const sourceRegex = /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i;
        const sourceMatch = data.match(sourceRegex);
        if (sourceMatch) return sourceMatch[1];

        // 3. البحث عن روابط Base64 (إذا كان المشغل يشفر الرابط)
        const base64Regex = /["']([A-Za-z0-9+/]{50,})={0,2}["']/g;
        let b64Matches;
        while ((b64Matches = base64Regex.exec(data)) !== null) {
            try {
                let decoded = Buffer.from(b64Matches[1], 'base64').toString('utf-8');
                if (decoded.includes('.m3u8')) {
                    return decoded.match(/https?[:\/\w\.-]+\.m3u8[^\s"']*/i)[0];
                }
            } catch (e) {}
        }

        return "";
    } catch (e) {
        // تم إخفاء رسالة الخطأ هنا لتنظيف الكونسول، يمكنك إعادتها إن شئت
        return "";
    }
}

/**
 * السكريبت الرئيسي للتعامل مع الـ API
 */
async function scrapeMatches() {
    try {
        console.log("🚀 جاري جلب المباريات من الـ API...");
        
        // توليد طابع زمني لمنع تخزين الكاش (Cache) وجلب بيانات جديدة دائماً
        const apiUrl = `https://www.majed-koora.com/config.json?v=${Date.now()}`;
        
        const { data } = await axios.get(apiUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' 
            }
        });

        // الحصول على مصفوفة المباريات من الـ JSON
        const matchesData = data.matches || [];
        const formattedMatches = [];

        for (let i = 0; i < matchesData.length; i++) {
            const matchInfo = matchesData[i];
            
            console.log(`🔍 جاري استخراج: ${matchInfo.team1} vs ${matchInfo.team2}`);

            // بناء رابط المشغل بناءً على قناة تويتش المرفقة في الـ API
            let streamUrl = "";
            if (matchInfo.twitch_channel) {
                streamUrl = `https://majed-koora.com/stream.php?channel=${matchInfo.twitch_channel}`;
            }

            // محاولة جلب رابط البث المباشر (m3u8) من المشغل
            let directStream = "";
            if (streamUrl) {
                directStream = await getDirectStream(streamUrl);
            }

            if (directStream) {
                console.log(`✅ تم العثور على الرابط المباشر!`);
            } else {
                console.log(`❌ لم يتم العثور على رابط مباشر`);
            }

            // تحويل حالة المباراة للغة المطلوبة
            let matchStatus = matchInfo.status;
            if (matchStatus && matchStatus.toLowerCase() === "live") {
                matchStatus = "جارية الآن";
            }

            // تجهيز الكائن بالشكل الذي طلبته
            const match = {
                id: i + 1,
                team1: matchInfo.team1 || "",
                team1Logo: matchInfo.logo1 || "",
                team2: matchInfo.team2 || "",
                team2Logo: matchInfo.logo2 || "",
                time: matchInfo.time || "",
                status: matchStatus,
                channel: matchInfo.commentator || "", // تم استخدام المعلق كقناة إذا لم تتوفر قناة
                league: matchInfo.comp || "", // comp تعني البطولة (Competition)
                streamUrl: streamUrl,
                stream: directStream
            };

            formattedMatches.push(match);
        }

        // حفظ البيانات في الملف
        fs.writeFileSync('matches.json', JSON.stringify(formattedMatches, null, 2), 'utf8');
        console.log("---");
        console.log(`✅ انتهى العمل. تم حفظ ${formattedMatches.length} مباراة في matches.json بنجاح.`);

    } catch (error) {
        console.error('❌ خطأ في السكربت الرئيسي:', error.message);
    }
}

scrapeMatches();
