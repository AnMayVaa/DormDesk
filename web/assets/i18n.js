// DormDesk i18n — Thai is the source language (and the default); English is a translation layer.
// How it works:
//  • UI strings stay in Thai in the HTML/JS. When English is on, every Thai text node and the
//    attributes placeholder / aria-label / title / alt are looked up in EN (also for content added
//    later — a MutationObserver translates new nodes).
//  • Strings with variables use DD_I18N.t("ห้อง {n}", { n }) so they translate as one sentence.
//  • User data (request titles, names, notes, dorm names) sits inside translate="no" and is never touched.
(function () {
  const EN = {
    // ---------------------------------------------------------------- common / chrome
    "ข้ามไปเนื้อหาหลัก": "Skip to main content",
    "เปลี่ยนเป็นธีมสว่าง": "Switch to light theme", "เปลี่ยนเป็นธีมมืด": "Switch to dark theme",
    "ยืนยัน": "Confirm", "ยกเลิก": "Cancel", "ปิด": "Close", "เปิด": "Open", "ลองใหม่": "Try again",
    "รีเฟรช": "Refresh", "อัปเดตแล้ว": "Updated", "อัปเดตข้อมูลแล้ว": "Data refreshed", "เกิดข้อผิดพลาด": "Something went wrong",
    "เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่": "Can't connect. Check your internet and try again.",
    "ส่งคำขอถี่เกินไป กรุณารอสักครู่": "Too many requests. Please wait a moment.",
    "เมื่อสักครู่": "just now", "ยังไม่เสร็จ": "Open", "ทั้งหมด": "All", "(ไม่บังคับ)": "(optional)",
    // status / priority
    "รับเรื่องแล้ว": "Received", "กำลังดำเนินการ": "In progress", "เสร็จสิ้น": "Done", "ปฏิเสธ / แจ้งซ้ำ": "Rejected / duplicate",
    "ปฏิเสธ": "Rejected", "ปกติ": "Normal", "ด่วน": "Urgent", "รับเรื่อง": "Received", "กำลังซ่อม": "Fixing",
    // categories (from the database)
    "ไฟฟ้า": "Electrical", "น้ำ / ประปา": "Water / plumbing", "แอร์": "Air-con", "ลิฟต์": "Elevator",
    "ของชำรุดในห้อง": "Broken item in room", "ของในห้อง": "In-room items", "Laundry": "Laundry", "พัสดุ": "Parcels",
    "Parking": "Parking", "อื่น ๆ": "Other",

    // ---------------------------------------------------------------- landing
    "DormDesk — ระบบแจ้งซ่อมหอพัก": "DormDesk — dorm repair requests",
    "ผู้เช่าแจ้งซ่อมผ่านลิงก์ประจำห้อง ติดตามสถานะได้เอง เจ้าของหอเห็นทุกเรื่องและตัวเลขการซ่อมในที่เดียว":
      "Tenants report repairs from a per-room link and track them; owners see every request and repair metrics in one place",
    "สำหรับเจ้าของหอ": "For dorm owners",
    "ข้อมูลแต่ละหอแยกขาดจากกัน · เข้ารหัสทุกการเชื่อมต่อ": "Each dorm's data is isolated · every connection encrypted",
    "แจ้งซ่อมหอพัก": "Dorm repair requests", "ไม่จมหายในแชท": "that don't get lost in chat",
    "ผู้เช่าแจ้งผ่านลิงก์ประจำห้องได้ในหนึ่งนาที พร้อมรูป และติดตามสถานะเองได้ทุกเมื่อ เจ้าของหอเห็นทุกเรื่องเรียงตามความเร่งด่วน และรู้ว่าอะไรเสียบ่อย ซ่อมเร็วแค่ไหน":
      "Tenants report a problem from their room link in a minute, with photos, and check its status any time. Owners see every request sorted by urgency and know what breaks most and how fast it gets fixed.",
    "เข้าสู่ระบบเจ้าของหอ": "Owner sign-in", "ดูวิธีทำงาน": "How it works",
    "ผู้เช่า: เปิดลิงก์ที่เจ้าของหอส่งให้ทาง LINE ตอนย้ายเข้า ไม่ต้องสมัครสมาชิก":
      "Tenants: open the link your dorm owner sent you on LINE when you moved in. No sign-up needed.",
    "หอพักบ้านสบาย · ห้อง 305": "Baan Sabai Dorm · Room 305", "แอร์ไม่เย็น มีน้ำหยด": "Air-con not cooling, dripping water",
    "วันนี้ 13:40 · เจ้าของหอ": "Today 13:40 · Owner", "ช่างจะเข้าห้องวันนี้ 17:00 น.": "A technician will visit today at 17:00.",
    "วันนี้ 09:12 · ผู้เช่า": "Today 09:12 · Tenant", "ห้อง 212 · ก๊อกน้ำรั่ว": "Room 212 · Leaking tap", "ซ่อมเฉลี่ย 18 ชม.": "Avg. fix 18 h",
    "ผู้เช่า": "Tenant", "เจ้าของหอ": "Owner",
    "ลิงก์ประจำห้อง แจ้งได้ในหนึ่งนาที": "One link per room. Report in a minute.",
    "ระบบรู้ทันทีว่าแจ้งจากหอไหน ห้องไหน ผู้เช่าไม่ต้องสมัคร ไม่ต้องจำรหัส เลือกหมวดปัญหา เขียนสั้น ๆ แนบรูป แล้วได้ลิงก์ติดตามกลับไป":
      "The system knows the dorm and room right away. No sign-up, no passwords: pick a category, write a line, add a photo and get a tracking link back.",
    "หมวดปัญหา 9 แบบ เจ้าของหอเปิด-ปิดเองได้": "9 problem categories the owner can switch on or off",
    "ลบพิกัด GPS ออกจากรูปอัตโนมัติ": "GPS location is removed from photos automatically",
    "ลิงก์หลุดหรือผู้เช่าย้ายออก เปลี่ยนลิงก์ใหม่ได้ทันที": "Link leaked or tenant moved out? Issue a new link instantly",
    "ปัญหาเกี่ยวกับอะไร": "What is the problem about?",
    "ติดตามสถานะ": "Status tracking", "ไม่ต้องทักถามซ้ำว่าถึงไหนแล้ว": "No more asking \"any update?\"",
    "ทุกครั้งที่เจ้าของหอเปลี่ยนสถานะหรือฝากข้อความ ผู้เช่าเห็นทันทีจากลิงก์ติดตาม และหน้าห้องจะจำเรื่องที่เคยแจ้งไว้ในเครื่อง":
      "Whenever the owner changes the status or leaves a note, the tenant sees it on the tracking link, and the room page remembers past reports on that device.",
    "ไฟในห้องน้ำดับ": "Bathroom light is out", "2 วันที่แล้ว": "2 days ago",
    "ตัวเลขที่ช่วยตัดสินใจ ไม่ใช่แค่กล่องข้อความ": "Numbers that help you decide, not just an inbox",
    "รู้ว่าเรื่องไหนค้างเกิน 48 ชั่วโมง หมวดไหนแจ้งบ่อย ช่างใช้เวลาเฉลี่ยเท่าไร และห้องไหนเสียซ้ำจนควรเปลี่ยนอุปกรณ์ ดูแลหลายหอได้ในบัญชีเดียว":
      "See which requests are open over 48 hours, which categories come up most, average repair time, and which rooms keep breaking. Manage several dorms from one account.",
    "เรียงงานตามความเร่งด่วนและอายุของเรื่อง": "Work sorted by urgency and age", "ประวัติการเปลี่ยนสถานะทุกครั้ง": "Full history of every status change",
    "HTTPS · API และฐานข้อมูลอยู่ใน private subnet": "HTTPS · API and database live in a private subnet",

    // ---------------------------------------------------------------- tenant form
    "แจ้งซ่อม — DormDesk": "Report a problem — DormDesk", "แจ้งซ่อม ห้อง": "Report a problem · Room",
    "ไม่ต้องสมัครสมาชิก ส่งแล้วจะได้ลิงก์ไว้ติดตามสถานะ": "No sign-up needed. You'll get a link to track the status.",
    "เรื่องที่คุณเคยแจ้งจากเครื่องนี้": "Your reports from this device",
    "กรุณาเลือกหมวดปัญหา": "Please choose a category", "รายละเอียด": "Details", "หัวข้อ": "Title",
    "กรอกหัวข้ออย่างน้อย 3 ตัวอักษร": "Enter a title of at least 3 characters", "อธิบายเพิ่มเติม": "More details",
    "รูปภาพ": "Photos", "(ไม่เกิน 3 รูป รวม 5 MB · JPG, PNG, WEBP)": "(up to 3 photos, 5 MB total · JPG, PNG, WEBP)",
    "แตะเพื่อเลือกรูป": "Tap to choose photos",
    "หรือลากรูปมาวางที่นี่ · รูปช่วยให้ช่างเตรียมอุปกรณ์ได้ถูก": "or drag them here · photos help the technician bring the right tools",
    "ช่องทางติดต่อกลับ": "How to reach you", "ชื่อผู้แจ้ง": "Your name", "กรุณากรอกชื่อ": "Please enter your name",
    "เบอร์โทร": "Phone", "เบอร์โทรไม่ถูกต้อง (ตัวเลข 9–10 หลัก)": "Invalid phone number (9–10 digits)", "อีเมล": "Email",
    "(ไม่บังคับ — รับแจ้งเตือนเมื่อสถานะเปลี่ยน)": "(optional — get notified when the status changes)",
    "รูปแบบอีเมลไม่ถูกต้อง": "Invalid email address",
    "จำชื่อและเบอร์ไว้ในเครื่องนี้ (สำหรับแจ้งครั้งหน้า)": "Remember my name and phone on this device (for next time)",
    "ยินยอมให้เจ้าของหอเก็บชื่อ เบอร์โทร และอีเมล เพื่อติดต่อเรื่องแจ้งซ่อมนี้เท่านั้น ข้อมูลส่วนตัวจะถูกลบหลังเรื่องเสร็จสิ้น 180 วัน":
      "I agree that the dorm owner may keep my name, phone and email only to contact me about this request. Personal data is deleted 180 days after the request is closed.",
    "ต้องยินยอมก่อนส่งเรื่อง": "Consent is required before sending", "ส่งเรื่องแจ้งซ่อม": "Send request", "กำลังส่ง…": "Sending…",
    "ส่งเรื่องเรียบร้อยแล้ว": "Request sent",
    "เก็บลิงก์นี้ไว้ดูสถานะ — เราจำไว้ในเครื่องนี้ให้ด้วย เปิดลิงก์ห้องครั้งหน้าจะเห็นเรื่องนี้ด้านบน":
      "Keep this link to check the status. We also saved it on this device — you'll see it at the top next time you open your room link.",
    "ดูสถานะ": "View status", "ส่งลิงก์เข้าแชทตัวเอง": "Send link to my chat", "แจ้งเรื่องอื่น": "Report another problem",
    "ใครมีลิงก์นี้จะเห็นสถานะเรื่องนี้ได้ อย่าแชร์ในกลุ่มสาธารณะ": "Anyone with this link can see this request. Don't post it in public groups.",
    "เช่น แอร์ไม่เย็น": "e.g. Air-con not cooling", "เป็นตั้งแต่เมื่อไร สะดวกให้ช่างเข้าช่วงไหน": "Since when? When can a technician come in?",
    "ลิงก์ติดตามสถานะ": "Tracking link", "คัดลอกลิงก์": "Copy link", "คัดลอกลิงก์แล้ว": "Link copied",
    "ติดตามเรื่องแจ้งซ่อม": "Track my repair request",
    "ลิงก์ห้องนี้ใช้ไม่ได้แล้ว": "This room link no longer works", "เปิดหน้าไม่สำเร็จ": "Couldn't open the page",
    "เจ้าของหออาจเปลี่ยนลิงก์ของห้องแล้ว กรุณาขอลิงก์ใหม่จากเจ้าของหอ": "The owner may have changed this room's link. Please ask them for the new one.",
    "รับเฉพาะรูป JPG, PNG หรือ WEBP": "Only JPG, PNG or WEBP images", "แนบได้ไม่เกิน 3 รูป": "Up to 3 photos",
    "รูปรวมกันต้องไม่เกิน 5 MB": "Photos must be 5 MB in total or less",
    // suggestion chips
    "ไฟในห้องดับ": "Room light is out", "ปลั๊กไฟไม่มีไฟ": "Power outlet not working", "เบรกเกอร์ตัดบ่อย": "Breaker keeps tripping",
    "ก๊อกน้ำรั่ว": "Leaking tap", "ชักโครกกดไม่ลง": "Toilet won't flush", "น้ำไหลอ่อน": "Low water pressure",
    "แอร์ไม่เย็น": "Air-con not cooling", "แอร์มีน้ำหยด": "Air-con dripping", "รีโมทแอร์เสีย": "Air-con remote broken",
    "ลิฟต์ค้าง": "Elevator stuck", "ปุ่มลิฟต์กดไม่ติด": "Elevator button not working", "ประตูตู้หลุด": "Wardrobe door came off",
    "ลูกบิดประตูหลวม": "Loose door knob", "มุ้งลวดขาด": "Torn window screen", "เครื่องซักผ้าไม่ปั่น": "Washing machine won't spin",
    "เครื่องอบผ้ากินเหรียญ": "Dryer ate my coins", "พัสดุหาย": "Missing parcel", "ไม่ได้รับแจ้งพัสดุ": "Wasn't told about a parcel",
    "มีรถจอดขวาง": "A car is blocking", "ไฟลานจอดรถดับ": "Parking lot light is out", "เสียงดังรบกวน": "Noise disturbance",
    "ขอเพิ่มถังขยะ": "Need another trash bin",

    // ---------------------------------------------------------------- tracking
    "ติดตามสถานะ — DormDesk": "Track status — DormDesk", "ความคืบหน้า": "Progress",
    "หน้านี้อัปเดตเองทุก 30 วินาที · มีปัญหาเร่งด่วนเกี่ยวกับความปลอดภัย โปรดโทรหาเจ้าของหอโดยตรง":
      "This page refreshes every 30 seconds · for urgent safety issues, call the dorm owner directly",
    "ไม่พบเรื่องนี้": "Request not found",
    "ลิงก์ติดตามอาจพิมพ์ผิด ลองเปิดจากลิงก์ที่ได้ตอนแจ้งเรื่องอีกครั้ง": "The tracking link may be mistyped. Try opening the link you got when you reported it.",
    "โหลดไม่สำเร็จ": "Couldn't load",

    // ---------------------------------------------------------------- admin
    "เจ้าของหอ — DormDesk": "Owner — DormDesk", "เลือกหอ": "Choose dorm",
    "ดูแลงานซ่อมทุกหอในที่เดียว": "All your dorms' repairs in one place",
    "เห็นเรื่องใหม่ทันที เรียงตามความเร่งด่วน": "See new requests right away, sorted by urgency",
    "อัปเดตสถานะ ผู้เช่าเห็นเองจากลิงก์ติดตาม": "Update the status — tenants see it on their tracking link",
    "รู้ว่าอะไรเสียบ่อย ซ่อมเร็วแค่ไหน": "Know what breaks most and how fast it's fixed",
    "เข้าสู่ระบบ": "Sign in", "สำหรับเจ้าของหอและผู้จัดการอาคาร": "For dorm owners and building managers", "รหัสผ่าน": "Password",
    "แสดงรหัสผ่าน": "Show password", "ล็อกอินผิด 5 ครั้งใน 10 นาที ระบบจะพักบัญชีชั่วคราว": "5 failed sign-ins in 10 minutes temporarily locks the account",
    "กรอกอีเมลและรหัสผ่าน": "Enter your email and password", "กำลังเข้าสู่ระบบ…": "Signing in…",
    "ออกจากระบบ": "Sign out", "ออกจากระบบแล้ว": "Signed out", "หอพัก": "Dorm",
    "ภาพรวม": "Overview", "คำขอแจ้งซ่อม": "Requests", "ห้อง & ลิงก์": "Rooms & links", "หมวดปัญหา": "Categories",
    "ยังไม่มีหอในบัญชีนี้": "No dorms in this account yet", "ติดต่อผู้ดูแลระบบเพื่อเพิ่มหอ": "Contact the administrator to add a dorm",
    "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่": "Session expired. Please sign in again.",
    "ยังไม่มีข้อมูลช่วงนี้": "No data for this period yet",
    "เรื่องที่ยังไม่เสร็จ": "Open requests", "ค้างเกิน 48 ชม.": "Open over 48 h", "เวลาซ่อมเฉลี่ย (30 วัน)": "Avg. repair time (30 days)",
    "ซ่อมเสร็จทั้งหมด": "Completed", "ค้างเกิน 48 ชั่วโมง": "Open for over 48 hours", "ไม่มีเรื่องค้างเกินกำหนด": "Nothing overdue",
    "ทุกเรื่องได้รับการดูแลภายใน 48 ชั่วโมง": "Every request was handled within 48 hours",
    "หมวดที่แจ้งบ่อย (30 วัน)": "Most reported categories (30 days)", "ห้องที่แจ้งซ้ำหมวดเดิม (90 วัน)": "Rooms with repeat problems (90 days)",
    "ยังไม่มีห้องที่เสียซ้ำ": "No repeat problems yet", "เวลาซ่อมเฉลี่ยตามหมวด (ชม., 90 วัน)": "Avg. repair time by category (hours, 90 days)",
    "ค้นหาเลขห้องหรือหัวข้อ": "Search room number or title", "ค้นหา": "Search", "ไม่พบคำขอที่ตรงกับคำค้น": "No requests match your search",
    "ไม่มีคำขอในกลุ่มนี้": "No requests here", "ลองค้นด้วยเลขห้องหรือคำอื่น": "Try a room number or another word",
    "เมื่อผู้เช่าแจ้งเรื่อง รายการจะแสดงที่นี่": "New tenant requests will appear here", "ล้างคำค้น": "Clear search",
    "กรองตามสถานะ": "Filter by status", "เฉพาะเรื่องด่วน": "Urgent only", "รายละเอียดคำขอ": "Request details",
    "เช่น ช่างจะเข้าห้องวันนี้ 17:00 น. (ผู้เช่าเห็นข้อความนี้ในหน้าติดตาม)": "e.g. A technician will visit today at 17:00 (the tenant sees this note)",
    "ไม่ได้ให้อีเมล": "No email given", "เปลี่ยนสถานะ": "Change status", "ข้อความถึงผู้เช่า (ไม่บังคับ)": "Note to tenant (optional)",
    "เรื่องด่วน": "Urgent", "ตั้งเป็นเรื่องด่วน": "Mark as urgent", "ตั้งเป็นเรื่องด่วนแล้ว": "Marked as urgent", "ตั้งเป็นเรื่องปกติแล้ว": "Marked as normal",
    "ประวัติ": "History", "เลขห้อง เช่น 405": "Room number, e.g. 405", "เลขห้องใหม่": "New room number", "เพิ่มห้อง": "Add room",
    "ค้นหาห้อง": "Search rooms", "คัดลอกไม่ได้": "Couldn't copy", "เปิดหน้าแจ้งซ่อมของห้องนี้": "Open this room's report page",
    "เปลี่ยนลิงก์ (ลิงก์เก่าใช้ไม่ได้ทันที)": "New link (the old link stops working immediately)", "เปลี่ยนลิงก์": "New link",
    "ลิงก์เก่าจะใช้ไม่ได้ทันที ใช้เมื่อผู้เช่าย้ายออกหรือลิงก์หลุด เรื่องที่เคยแจ้งไว้ยังอยู่ครบ":
      "The old link stops working immediately. Use this when a tenant moves out or the link leaks. Past requests are kept.",
    "ไม่พบห้องนี้": "Room not found", "ยังไม่มีห้อง": "No rooms yet", "เพิ่มห้องด้านบน แล้วส่งลิงก์ให้ผู้เช่าทาง LINE": "Add a room above, then send its link to the tenant on LINE",
    "ส่งลิงก์ประจำห้องให้ผู้เช่าตอนย้ายเข้า ผู้เช่าเปิดลิงก์แล้วแจ้งซ่อมได้ทันทีโดยไม่ต้องสมัคร":
      "Send each room's link to the tenant when they move in. They can report problems right away, no sign-up.",
    "หมวดที่ผู้เช่าเลือกได้": "Categories tenants can choose",
    "ปิดหมวดที่หอไม่มี เช่น หอที่ไม่มีลานจอดรถ ผู้เช่าจะไม่เห็นหมวดนั้นในฟอร์ม": "Turn off categories your dorm doesn't have (e.g. no parking). Tenants won't see them in the form.",

    // ---------------------------------------------------------------- AI Insight
    "ถาม AI": "Ask AI", "ถาม": "Ask", "คำถาม": "Question", "พิมพ์คำถาม เช่น ตอนนี้ค้างกี่เรื่อง": "Type a question, e.g. How many requests are open?",
    "ถาม AI เกี่ยวกับหอของคุณ": "Ask AI about your dorm",
    "ระบบคำนวณตัวเลขจากฐานข้อมูลของหอนี้ก่อน แล้วให้ AI เรียบเรียงเป็นคำตอบ AI เห็นเฉพาะตัวเลขสรุป ไม่เห็นชื่อ เบอร์ หรือข้อความของผู้เช่า":
      "The system first computes the numbers from this dorm's database, then AI phrases the answer. The AI only sees aggregated numbers — never tenants' names, phones or messages.",
    "โมเดล AI ออนไลน์ · Qwen3 0.6B บน ai-01": "AI model online · Qwen3 0.6B on ai-01", "โมเดล AI ออฟไลน์ · ใช้สรุปอัตโนมัติแทน": "AI model offline · using automatic summary",
    "ตอบโดย AI ในระบบ (ai-01)": "Answered by in-house AI (ai-01)", "สรุปอัตโนมัติจากตัวเลข": "Automatic summary from the numbers",
    "ตัวเลขที่ใช้ตอบ (คำนวณจากฐานข้อมูล ไม่ใช่ AI เดา)": "Numbers behind this answer (computed from the database, not guessed by AI)",
    "กำลังคิด… โมเดลในเครื่อง ai-01 อาจใช้ 10–30 วินาที": "Thinking… the in-house model on ai-01 may take 10–30 seconds", "กำลังสรุป…": "Summarizing…",
    "ถามถี่เกินไป กรุณารอสักครู่": "Too many questions. Please wait a moment.",
    // ---------------------------------------------------------------- API error messages
    "กรุณายินยอมให้เก็บข้อมูลเพื่อใช้ติดต่อเรื่องแจ้งซ่อม": "Please agree to data collection so we can contact you about this request",
    "กรุณาเข้าสู่ระบบ": "Please sign in", "ค่าสถานะหรือความเร่งด่วนไม่ถูกต้อง": "Invalid status or priority",
    "ตัวกรองไม่ถูกต้อง": "Invalid filter", "มีห้องนี้อยู่แล้ว": "This room already exists",
    "ลิงก์ห้องไม่ถูกต้องหรือถูกเปลี่ยนแล้ว กรุณาติดต่อเจ้าของหอ": "This room link is invalid or was changed. Please contact the dorm owner.",
    "หมวดปัญหาไม่ถูกต้อง": "Invalid category", "ห้องนี้แจ้งเรื่องถี่เกินไป กรุณารอสักครู่แล้วลองใหม่": "Too many reports from this room. Please wait a bit and try again.",
    "อีเมลหรือรหัสผ่านไม่ถูกต้อง": "Wrong email or password", "อีเมลไม่ถูกต้อง": "Invalid email",
    "เข้าสู่ระบบผิดหลายครั้ง กรุณารอ 10 นาที": "Too many failed sign-ins. Please wait 10 minutes.",
    "เบอร์โทรไม่ถูกต้อง": "Invalid phone number", "ไฟล์ต้องเป็นรูปภาพ JPG, PNG หรือ WEBP": "Files must be JPG, PNG or WEBP images",
    "ไม่พบข้อมูล": "Not found", "ไม่พบคำขอ": "Request not found", "ไม่พบคำขอนี้": "Request not found", "ไม่พบรูป": "Photo not found",
    "ไม่พบหมวด": "Category not found", "ไม่มีสิทธิ์เข้าถึงหอนี้": "You don't have access to this dorm",
    "แนบรูปได้ไม่เกิน 3 รูป": "Up to 3 photos", "เกิดข้อผิดพลาดภายในระบบ": "Internal error. Please try again.",

    // ---------------------------------------------------------------- templates (used with t())
    "{n} นาทีที่แล้ว": "{n} min ago", "{n} ชม.ที่แล้ว": "{n} h ago", "{n} วันที่แล้ว": "{n} days ago",
    "เกิดข้อผิดพลาด ({n}) กรุณาลองใหม่": "Something went wrong ({n}). Please try again.",
    "แจ้งซ่อม ห้อง {n} — DormDesk": "Report a problem · Room {n} — DormDesk",
    "รูปที่เลือก {n}": "Selected photo {n}", "ลบรูปที่ {n}": "Remove photo {n}", "เปิดรูปที่ {n}": "Open photo {n}", "รูปที่แนบ {n}": "Attached photo {n}",
    "{dorm} · ห้อง {room} · {cat}": "{dorm} · Room {room} · {cat}", "แจ้งเมื่อ {d}": "Reported {d}", "{d} · ผู้เช่าแจ้งเรื่อง": "{d} · reported by tenant",
    "อัปเดตล่าสุด {t}": "Last updated {t}", "{title} — ติดตามสถานะ": "{title} — status",
    "อัปเดต {t}": "Updated {t}", "ห้อง {room} {title}": "Room {room} {title}", "{h} ชม.": "{h} h", "{n} ครั้ง": "{n} times",
    "{label} {n}": "{label} {n}", "แจ้ง {d} · {ago}": "Reported {d} · {ago}", "ห้อง {room} · {cat}": "Room {room} · {cat}",
    "เปลี่ยนเป็น \"{s}\" แล้ว": "Changed to \"{s}\"", "{d} · ผู้เช่า": "{d} · tenant", "{d} · เจ้าของหอ": "{d} · owner",
    "ห้อง {room}": "Room {room}", "{n} เรื่องค้าง": "{n} open", "ไม่มีเรื่องค้าง": "Nothing open",
    "คัดลอกลิงก์ห้อง {room} แล้ว": "Copied the link for room {room}", "เพิ่มห้อง {room} แล้ว": "Room {room} added",
    "เปิดหน้าแจ้งซ่อมห้อง {room}": "Open report page for room {room}", "เปลี่ยนลิงก์ห้อง {room}": "New link for room {room}",
    "เปลี่ยนลิงก์ห้อง {room}?": "Issue a new link for room {room}?", "ออกลิงก์ใหม่ให้ห้อง {room} แล้ว": "New link issued for room {room}",
    "ห้องทั้งหมด {n} ห้อง": "{n} rooms", "เปิดหมวด {c} แล้ว": "Category {c} turned on", "ปิดหมวด {c} แล้ว": "Category {c} turned off",
    "ข้อมูลไม่ถูกต้อง: {f}": "Invalid input: {f}",
  };

  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const DICT = {};
  for (const [k, v] of Object.entries(EN)) DICT[norm(k)] = v;

  let lang = "th";
  try { lang = localStorage.getItem("dd-lang") === "en" ? "en" : "th"; } catch (e) { /* storage blocked */ }
  document.documentElement.lang = lang;

  function t(key, vars) {
    let s = lang === "en" ? (DICT[norm(key)] ?? key) : key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split("{" + k + "}").join(String(v));
    return s;
  }
  // server messages like "ข้อมูลไม่ถูกต้อง: title"
  function tMessage(msg) {
    if (lang !== "en" || !msg) return msg;
    const m = /^ข้อมูลไม่ถูกต้อง: (.+)$/.exec(msg);
    return m ? t("ข้อมูลไม่ถูกต้อง: {f}", { f: m[1] }) : t(msg);
  }

  const TH = /[฀-๿]/;
  const ATTRS = ["placeholder", "aria-label", "title", "alt"];
  const skip = (node) => { const e = node.nodeType === 1 ? node : node.parentElement; return !e || !!e.closest('[translate="no"],script,style,textarea'); };
  const skipAttr = (e) => !!e.closest('[translate="no"]');
  function translateText(n) {
    if (!TH.test(n.nodeValue) || skip(n)) return;
    const k = norm(n.nodeValue);
    const v = DICT[k];
    if (v !== undefined) {
      const lead = /^\s/.test(n.nodeValue) ? " " : "", trail = /\s$/.test(n.nodeValue) ? " " : "";
      n.nodeValue = lead + v + trail;
    }
  }
  function translateEl(e) {
    if (skipAttr(e)) return;
    for (const a of ATTRS) { const v = e.getAttribute(a); if (v && TH.test(v) && DICT[norm(v)]) e.setAttribute(a, DICT[norm(v)]); }
  }
  function translateTree(root) {
    if (root.nodeType === 3) return translateText(root);
    if (root.nodeType !== 1) return;
    translateEl(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) n.nodeType === 3 ? translateText(n) : translateEl(n);
  }

  function setLang(l) {
    try { localStorage.setItem("dd-lang", l); } catch (e) { /* ignore */ }
    location.reload();   // simplest reliable way to re-render every page in the new language
  }
  function initToggle() {
    document.querySelectorAll("[data-lang-toggle]").forEach((b) => {
      b.textContent = lang === "en" ? "ไทย" : "EN";
      b.setAttribute("aria-label", lang === "en" ? "เปลี่ยนเป็นภาษาไทย" : "Switch to English");
      b.setAttribute("title", b.getAttribute("aria-label"));
      b.setAttribute("translate", "no");
      b.addEventListener("click", () => setLang(lang === "en" ? "th" : "en"));
    });
  }

  if (lang === "en") {
    translateTree(document.body);
    document.title = t(document.title);
    const md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute("content", t(md.getAttribute("content")));
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") translateText(m.target);
        else if (m.type === "attributes") translateEl(m.target);
        else m.addedNodes.forEach(translateTree);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  initToggle();
  window.DD_I18N = { t, tMessage, lang, locale: lang === "en" ? "en-GB" : "th-TH" };
})();
