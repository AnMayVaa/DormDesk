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

    // ---------------------------------------------------------------- v2: tenant hub, owner tabs, API messages
    "{n} หน่วย": "{n} units",
    "{n} บาท": "{n} THB", "ค่าปรับ (เรียกเก็บแยก)": "Fine (billed separately)", "รอชำระ": "Unpaid",
    "รอตรวจสลิป": "Slip under review", "สลิปถูกตีกลับ": "Slip returned", "เกินกำหนด": "Overdue",
    "ชำระแล้ว": "Paid", "รอเจ้าของหอตรวจ": "Waiting for the owner", "ถูกตีกลับ": "Returned",
    "ใช้งานอยู่": "Active", "แจ้งยกเลิก": "Cancellation notice", "ยกเลิกแล้ว": "Cancelled",
    "ถอนคำขอ": "Withdrawn", "จองแล้ว": "Booked", "ยืนยันแล้ว": "Confirmed",
    "ยกเลิกช้า (นับเป็นไม่มา)": "Late cancel (counts as no-show)", "จองแล้วไม่มา": "No-show", "ถูกยกเลิก": "Cancelled by owner",
    "รอคุณตอบกลับ": "Waiting for your reply", "โต้แย้งแล้ว · รอเจ้าของหอ": "Disputed · waiting for the owner", "รวมในบิลแล้ว": "Added to a bill",
    "รถยนต์": "Car", "มอเตอร์ไซค์": "Motorcycle", "ห้องของฉัน": "My room",
    "พิมพ์ข้อความถึงเจ้าของหอ": "Write a message to the owner", "ข้อความ": "Messages", "ส่ง": "Send",
    "ตอบกลับ": "Reply", "ติดต่อเจ้าของหอ:": "Contact the owner:", "มีค่าปรับ {n} รายการ · {a}": "{n} fine(s) · {a}",
    "แตะเพื่อดูเหตุผลและตอบกลับ": "tap to see why and reply", "แจ้งซ่อม": "Repairs", "ส่วนกลาง": "Facilities",
    "ที่จอดรถ": "Parking", "บิล": "Bills", "มีรายการที่ต้องดู": "Needs attention",
    "บิล {p}": "Bill {p}", "ครบกำหนด {d}": "Due {d}", "รถยนต์ {a}/{b} · มอเตอร์ไซค์ {c}/{d}": "Car {a}/{b} · Motorcycle {c}/{d}",
    "ต้องดู": "Check", "แจ้งเตือนทางอีเมล": "E-mail notifications", "เปิดอยู่ (บิลใหม่ ค่าปรับ ที่จอดรถ)": "On (new bills, fines, parking)",
    "ยังไม่ได้ตั้ง": "Not set", "เปลี่ยน": "Change", "ตั้งค่า": "Set up",
    "บันทึกอีเมลแล้ว": "E-mail saved", "ปิดการแจ้งเตือนแล้ว": "Notifications turned off", "อีเมลรับแจ้งเตือน (เว้นว่าง = ปิด)": "Notification e-mail (leave empty = off)",
    "ยินยอมให้หอใช้อีเมลนี้แจ้งเรื่องบิล ค่าปรับ และที่จอดรถของห้องนี้เท่านั้น ลบเมื่อย้ายออก": "I agree the dorm may use this e-mail only for this room's bills, fines and parking. It is deleted when I move out.", "บันทึก": "Save", "กำลังใช้งานอยู่": "In use now",
    "ห้องนี้ {a}/{b} คน": "This room {a}/{b} people", "เข้า {a} · หมดเวลา {b}": "In {a} · expires {b}", "แสดงบัตร": "Show pass",
    "เช็กเอาท์แล้ว": "Checked out", "เช็กเอาท์": "Check out", "ปิดอยู่": "Closed",
    "เปิดอยู่": "Open", "เต็ม": "Full", "ใกล้เต็ม": "Almost full",
    "ว่าง": "Free", "ใช้อยู่ {n}/{c} คน": "{n}/{c} people now", "ใช้อยู่ {n} คน": "{n} people now",
    "ต้องจองล่วงหน้า · สัปดาห์นี้จองได้อีก {n} ครั้ง": "Booking required · {n} left this week", "ต้องจองล่วงหน้า": "Booking required", "จอง": "Book",
    "ตอนนี้มีคนใช้กี่คน": "How busy is it now", "หอนี้ยังไม่มีพื้นที่ส่วนกลาง": "This dorm has no shared facilities yet", "สแกน QR เพื่อเช็กอิน": "Scan QR to check in",
    "เช็กอินฟิตเนส / สระ": "Gym / pool check-in", "เล็งกล้องไปที่ QR บนโต๊ะคนตรวจ": "Point the camera at the QR on the desk", "ตอนนี้เต็มแล้ว ให้คนตรวจตัดสินที่หน้างาน": "It's full right now — the staff at the desk will decide",
    "สแกน QR ที่โต๊ะคนตรวจ แล้วแสดงบัตรให้คนตรวจดู เช็กอินมีผล {h} ชั่วโมง ครบแล้วระบบเช็กเอาท์ให้เอง": "Scan the QR at the desk, then show your pass. A check-in lasts {h} hours, then you are checked out automatically.", "ห้องเดียวกันเช็กอินพร้อมกันได้ไม่เกิน {n} คน": "Up to {n} people per room at the same time", "บัตรเช็กอิน": "Check-in pass",
    "กำลังใช้งาน": "Active", "หมดเวลาแล้ว": "Expired", "ห้อง": "Room",
    "เวลาตอนนี้": "Time now", "เข้า": "In", "หมดเวลา": "Expires",
    "เหลือเวลา": "Time left", "ห้องนี้ใช้อยู่": "This room now", "{a}/{b} คน": "{a}/{b} people",
    "{h} ชม. {m} นาที": "{h} h {m} min", "กลับ": "Back", "แสดงหน้านี้ให้คนตรวจที่โต๊ะดู นาฬิกาต้องเดินอยู่ ภาพหน้าจอที่แคปไว้ใช้ไม่ได้": "Show this page at the desk. The clock must be running — a screenshot is not valid.",
    "จองห้องส่วนกลาง": "Book a common room", "ยังไม่มีห้องให้จอง": "No rooms to book yet", "การจองของฉัน": "My bookings",
    "ยังไม่มีการจองที่กำลังจะถึง": "No upcoming bookings", "สแกน QR ที่หน้าห้องภายใน {t} ถ้าไม่สแกน ระบบจะปล่อยห้องให้คนอื่นและนับเป็นจองแล้วไม่มา": "Scan the QR at the room before {t}. If not, the room is released and it counts as a no-show.", "สแกนยืนยัน": "Scan to confirm",
    "ยืนยันว่ามาใช้ห้องจริง": "Confirm you are here", "สแกน QR ที่ติดหน้าห้อง": "Scan the QR at the door", "ยืนยันแล้ว ใช้ห้องได้เลย": "Confirmed — enjoy the room",
    "ยกเลิกการจองนี้?": "Cancel this booking?", "ยกเลิกการจอง": "Cancel booking", "เหลือน้อยกว่า {h} ชั่วโมง การยกเลิกตอนนี้นับเป็น \"จองแล้วไม่มา\" 1 ครั้ง": "Less than {h} hours left: cancelling now counts as one no-show",
    "ได้โควตาคืน ไม่นับเป็นจองแล้วไม่มา": "Your quota is returned and it is not a no-show", "ยกเลิกก่อนเวลาเริ่มอย่างน้อย {h} ชั่วโมงจะได้โควตาคืน และไม่นับเป็นจองแล้วไม่มา": "Cancel at least {h} hours before the start to get your quota back without a no-show.", "งดการจองถึง {d} เพราะจองแล้วไม่มาครบ {n} ครั้ง": "Booking suspended until {d} after {n} no-shows",
    "คุณจองแล้วไม่มา {n} ครั้งใน {w} วันที่ผ่านมา ถ้าครบ {m} ครั้ง จะจองไม่ได้ {d} วัน": "You had {n} no-show(s) in the last {w} days. At {m} you cannot book for {d} days.", "เลือกช่วงเวลา": "Choose a time", "เลือกห้อง": "Choose a room",
    "เลือกวัน": "Choose a day", "จองช่วงเวลา": "Book a time slot", "สัปดาห์นี้จองได้อีก {a} จาก {b} ครั้ง": "{a} of {b} bookings left this week",
    "จองแล้วได้ห้องทันที ไม่ต้องรอเจ้าของหออนุมัติ": "Booked instantly — no owner approval needed", "มีคนจอง": "Taken", "ของฉัน": "Mine",
    "จอง {d} {a}–{b}": "Book {d} {a}–{b}", "ไม่มีช่วงเวลาที่จองได้ในวันนี้": "No bookable times on this day", "สิทธิ์ที่จอดของห้อง": "Room parking permits",
    "รถยนต์ {a}/{b} ที่ · มอเตอร์ไซค์ {c}/{e} ที่": "Car {a}/{b} · Motorcycle {c}/{e}", "ห้องนี้ยังไม่มีสิทธิ์ที่จอด": "No parking permit yet", "สติกเกอร์ {s}": "sticker {s}",
    "ช่อง {s}": "space {s}", "{n} บาท/เดือน": "{n} THB/month", "วัน": "days",
    "เจ้าของหอแจ้งยกเลิกสิทธิ์ที่จอดนี้": "The owner is cancelling this parking permit", "เหตุผล:": "Reason:", "สิทธิ์จะสิ้นสุดเมื่อคุณกดรับทราบ หรือครบ {n} วัน ({d}) ค่าจอดจะหยุดเก็บตั้งแต่บิลเดือนถัดไป": "It ends when you acknowledge, or after {n} days ({d}). The parking fee stops from next month's bill.",
    "ส่งข้อความแล้ว": "Message sent", "รับทราบการยกเลิก?": "Acknowledge the cancellation?", "สิทธิ์ที่จอดนี้จะสิ้นสุดทันที": "This permit ends immediately",
    "รับทราบ": "Acknowledge", "รับทราบแล้ว": "Acknowledged", "รับทราบการยกเลิก": "Acknowledge cancellation",
    "โทร": "Call", "ยื่นขอสิทธิ์ที่จอด": "Apply for parking", "คำขอ{v}ถูกตีกลับ": "Your {v} request was returned",
    "ส่งคำขอแล้ว {n} รายการ รอเจ้าของหอตรวจ": "{n} request(s) sent, waiting for the owner", "เช่น กข 1234": "e.g. กข 1234", "กรุงเทพมหานคร": "Bangkok",
    "เช่น Honda สีแดง": "e.g. red Honda", "ประเภทรถ": "Vehicle type", "ส่งให้เจ้าของหอตรวจอีกครั้ง": "Send to the owner again",
    "ส่งคำขอ": "Send request", "มีที่จอดว่างแล้ว ยื่นคำขอได้เลย": "A space is free — apply now", "ที่จอด{v}เต็ม คุณอยู่คิวที่ {n} ระบบจะแจ้งเมื่อมีช่องว่าง": "{v} parking is full. You are number {n} in the queue; we'll tell you when a space opens.",
    "ออกจากคิว": "Leave queue", "ที่จอด{v}เต็มแล้ว": "{v} parking is full", "ลงชื่อรอคิวแล้ว": "Added to the queue",
    "ลงชื่อรอคิว": "Join the queue", "ส่งคำขอแล้ว รอเจ้าของหอตรวจ": "Request sent, waiting for the owner", "ทะเบียนรถ": "Licence plate",
    "จังหวัด": "Province", "ประเภท": "Type", "ยี่ห้อ / สี": "Brand / colour",
    "บัตรจอดแขก": "Guest parking pass", "รอเจ้าของหออนุมัติ": "Waiting for owner approval", "ไม่อนุมัติ": "Not approved",
    "บัตรจอดแขก · ใช้ได้ถึง 23:59": "Guest pass · valid until 23:59", "{d} · มาหาห้อง {r}": "{d} · visiting room {r}", "ทะเบียนรถแขก": "Guest licence plate",
    "ขอบัตรจอดแขก": "Request a guest pass", "ออกบัตรจอดแขกแล้ว": "Guest pass issued", "วันที่": "Date",
    "หอนี้ต้องให้เจ้าของหออนุมัติก่อน": "This dorm needs owner approval first", "แสดงบัตรนี้ให้ รปภ. ดู ใช้ได้ 1 วัน": "Show this pass to security. Valid for one day.", "ยังไม่มีบิล": "No bills yet",
    "เมื่อเจ้าของหอออกบิล บิลจะแสดงที่นี่": "Bills from the owner will appear here", "บิลที่ชำระแล้ว": "Paid bills", "เลขที่ {n}": "No. {n}",
    "ใบเสร็จ": "Receipt", "รวม": "Total", "ครบกำหนด": "Due",
    "เจ้าของหอแก้ไขบิลนี้ · เหตุผล:": "The owner edited this bill · reason:", "เกินกำหนด {g} วันขึ้นไป คิดค่าปรับจ่ายช้าวันละ {n} บาท (รวมในบิลถัดไป)": "More than {g} days late: a late fee of {n} THB per day (added to the next bill)", "ชำระเงิน": "Payment",
    "ส่งสลิปแล้ว รอเจ้าของหอยืนยัน จะได้อีเมลแจ้งพร้อมใบเสร็จ": "Slip sent. Waiting for the owner; you'll get an e-mail with the receipt.", "เจ้าของหอ:": "Owner:", "QR พร้อมเพย์ ยอด {a}": "PromptPay QR for {a}",
    "พร้อมเพย์:": "PromptPay:", "หอนี้ยังไม่ได้ตั้งเลขพร้อมเพย์ โอนตามบัญชีที่เจ้าของหอแจ้ง แล้วแนบสลิป": "No PromptPay number set. Transfer to the account the owner gave you, then attach the slip.", "JPG, PNG, WEBP · ไม่เกิน 5 MB": "JPG, PNG, WEBP · up to 5 MB",
    "ส่งสลิปให้เจ้าของหอ": "Send slip to the owner", "กรุณาเลือกรูปสลิป": "Please choose the slip image", "รูปต้องไม่เกิน 5 MB": "The image must be under 5 MB",
    "ส่งสลิปแล้ว": "Slip sent", "แนบสลิปการโอน": "Attach transfer slip", "แตะเพื่อเลือกรูปสลิป": "Tap to choose the slip",
    "ใบเสร็จรับเงิน · ห้อง {r} · งวด {p} · ชำระ {d}": "Receipt · room {r} · period {p} · paid {d}", "หลักฐานการชำระเงินในระบบ DormDesk ไม่ใช่ใบกำกับภาษี": "Proof of payment in DormDesk — not a tax invoice", "ใบเสร็จ {p}": "Receipt {p}",
    "บันทึกใบเสร็จ (PDF)": "Save receipt (PDF)", "ค่าปรับของห้องนี้": "Fines for this room", "ไม่มีค่าปรับ": "No fines",
    "ค่าปรับ": "Fine", "ลดจาก {a}": "reduced from {a}", "ออกเมื่อ {d} · ห้อง {r} · หมวด {p}": "Issued {d} · room {r} · {p}",
    "จ่ายช้า": "Late payment", "ทำของเสียหาย": "Damage", "ผิดกฎที่จอด": "Parking rule",
    "เหตุผลจากเจ้าของหอ": "Owner's reason", "รูปหลักฐาน": "Evidence photos", "รูปหลักฐาน {n}": "Evidence photo {n}",
    "รวมในบิล {p} แล้ว": "Added to the {p} bill", "เรียกเก็บแยก ดูได้ในแท็บบิล": "Billed separately — see the Bills tab", "รอเจ้าของหอตรวจข้อโต้แย้ง": "The owner is reviewing your dispute",
    "ถ้าไม่โต้แย้ง ค่าปรับนี้จะรวมในบิลเดือนถัดไป": "If you don't dispute it, it will be added to next month's bill", "ติดต่อเจ้าของหอ": "Contact the owner", "ติดต่อผ่านข้อความด้านล่าง": "Use the messages below",
    "ยังไม่มีข้อความ ตอบกลับหรือโต้แย้งได้ที่นี่": "No messages yet. Reply or dispute here.", "ค่าปรับแยก": "Separate fine", "ร่าง": "Draft",
    "สลิปรอตรวจ": "Slip to check", "ตีกลับแล้ว": "Returned", "รอผู้เช่า": "Waiting for tenant",
    "โต้แย้ง": "Disputed", "ค่าเช่าห้อง": "Rent", "ค่าน้ำ": "Water",
    "ค่าไฟ": "Electricity", "ค่าที่จอดรถ": "Parking fee", "ค่าส่วนกลาง": "Common fee",
    "ค่าปรับจ่ายช้า": "Late fee", "ปรับยอด": "Adjustment", "ยังไม่มีข้อความ": "No messages yet",
    "พิมพ์ข้อความถึงผู้เช่า": "Write a message to the tenant", "กรอกอย่างน้อย {n} ตัวอักษร": "Enter at least {n} characters", "ส่วนกลาง & การเงิน": "Facilities & finance",
    "ใหม่": "New", "การเงิน · บิล {p}": "Finance · {p} bills", "ห้องชำระแล้ว (จาก {n})": "Rooms paid (of {n})",
    "สลิปรอยืนยัน": "Slips to confirm", "ยังไม่ชำระ (ยังไม่ถึงกำหนด)": "Unpaid (not yet due)", "ยอดเก็บได้เดือนนี้": "Collected this month",
    "/ {n} บาท": "/ {n} THB", "ร่าง {n} ใบ รอกรอกมิเตอร์/ออกบิล": "{n} draft(s) waiting for meter readings / issuing", "ห้องเกินกำหนด": "Overdue rooms",
    "ยอดค้าง": "Outstanding", "เกินมา": "Late by", "{n} วัน": "{n} days",
    "ไม่มีห้องค้างเกินกำหนด": "No overdue rooms", "ไม่มีค่าปรับที่ค้างอยู่": "No open fines", "/ {n} ช่องถูกใช้": "/ {n} spaces used",
    "สิทธิ์ที่ใช้งานอยู่": "Active permits", "รออนุมัติ": "Pending", "กำลังยกเลิก": "Being cancelled",
    "เกินโควตา": "Over quota", "คิวรอ": "Queue", "ห้องส่วนกลาง": "Common rooms",
    "การจองวันนี้": "bookings today", "จองแล้วไม่มา (30 วัน)": "No-shows (30 days)", "งดจอง {n} ห้อง": "{n} room(s) suspended",
    "ห้อง {r} ถึง {d}": "room {r} until {d}", "ฟิตเนสและสระ ตอนนี้": "Gym & pool now", "ช่วงที่คนแน่น (เฉลี่ยต่อวัน 30 วัน)": "Busiest hours (daily average, 30 days)",
    "งวด": "Period", "ยอดบิล": "Bill total", "ส่งเมื่อ": "Sent",
    "สลิป": "Slip", "ดูสลิป": "View slip", "ยืนยันแล้ว · ใบเสร็จ {n}": "Confirmed · receipt {n}",
    "ตีกลับสลิปห้อง {r}": "Return the slip of room {r}", "ข้อความถึงผู้เช่า": "Message to the tenant", "ส่งข้อความและตีกลับ": "Send message and return",
    "ตีกลับ": "Return", "ไม่มีสลิปรอยืนยัน": "No slips waiting", "ค่าเช่าห้อง {r}": "Rent of room {r}",
    "หน่วยน้ำห้อง {r}": "Water units room {r}", "หน่วยไฟห้อง {r}": "Electricity units room {r}", "บันทึกค่าเช่า/มิเตอร์": "Save rent / meters",
    "บันทึกแล้ว": "Saved", "สร้างบิลงวดนี้": "Create this period's bills", "สร้าง {a} ใบ · ส่งให้ผู้เช่า {b} ใบ": "{a} created · {b} sent to tenants",
    "ห้องที่ยังไม่มีเลขมิเตอร์: {r}": "Rooms without meter readings: {r}", "บิลรายเดือน": "Monthly bills", "กรอกค่าเช่าและเลขหน่วยมิเตอร์ แล้วกด \"สร้างบิลงวดนี้\" ห้องที่ครบจะส่งบิลให้ผู้เช่าทันที ห้องที่ยังไม่มีมิเตอร์จะเป็นร่าง": "Enter rent and meter units, then press \"Create this period's bills\". Complete rooms are sent to tenants right away; rooms without readings stay as drafts.",
    "ค่าเช่า (บาท)": "Rent (THB)", "น้ำ (หน่วย)": "Water (units)", "ไฟ (หน่วย)": "Electricity (units)",
    "สถานะ": "Status", "ยอด": "Amount", "ค้างชำระงวดอื่น / ผู้เช่าก่อนหน้า": "Outstanding from other periods / previous tenants",
    "ผู้เช่าก่อนหน้า": "Previous tenant", "ตามมิเตอร์": "By meter", "เหมาจ่าย": "Flat rate",
    "ไม่เก็บ": "Not charged", "บิลอัตโนมัติรายเดือน": "Automatic monthly bills", "เปิดใช้บิลอัตโนมัติ": "Automatic billing",
    "เปิดบิลอัตโนมัติ": "Turn on automatic billing", "ออกบิลทุกวันที่": "Issue bills on day", "ครบกำหนดชำระวันที่": "Payment due on day",
    "ค่าส่วนกลาง (บาท/เดือน)": "Common fee (THB/month)", "บาท/หน่วย": "THB/unit", "เหมา": "flat",
    "ค่าน้ำไฟแบบมิเตอร์ ต้องกรอกเลขหน่วยก่อน บิลห้องนั้นจะเป็นร่างจนกว่าจะกรอก": "Metered water/electricity need readings first; that room's bill stays a draft until you enter them.", "ค่าปรับจ่ายช้าอัตโนมัติ": "Automatic late fee", "เกินกำหนดกี่วัน · บาทต่อวัน (รวมในบิลถัดไป)": "Days of grace · THB per day (added to the next bill)",
    "เลขพร้อมเพย์ของหอ": "Dorm PromptPay number", "เบอร์ 10 หลัก / เลข 13 หลัก": "10-digit phone / 13-digit ID", "บันทึกการตั้งค่าบิลแล้ว": "Billing settings saved",
    "หมายเหตุ": "Note", "ลบรายการ": "Remove line", "เช่น จดเลขมิเตอร์ไฟผิด": "e.g. wrong electricity reading",
    "บิลห้อง {r} · {p}": "Bill room {r} · {p}", "ใบเสร็จ {n}": "Receipt {n}", "เพิ่มรายการ (กดหัวข้อ แล้วกรอกยอด)": "Add a line (pick a type, then enter the amount)",
    "บิลที่ชำระแล้วแก้ไม่ได้ ถ้าต้องปรับ ให้ใส่รายการ \"ปรับยอด\" ในบิลถัดไป": "A paid bill cannot be edited. Add an \"Adjustment\" line to the next bill instead.", "รายการ": "Item", "ยอด (บาท)": "Amount (THB)",
    "เหตุผลที่แก้ไข": "Reason for the change", "(ต้องกรอก ผู้เช่าจะได้รับแจ้ง)": "(required — the tenant is notified)", "บันทึกการแก้ไข": "Save changes",
    "ส่งบิลให้ผู้เช่า": "Send bill to tenant", "ยืนยันรับเงินแล้ว": "Mark as paid", "ยกเลิกบิลนี้?": "Cancel this bill?",
    "เหตุผล": "Reason", "ยกเลิกบิล": "Cancel bill", "รอตรวจ": "To check",
    "ดู": "View", "ประวัติการแก้ไข": "Change history", "ข้อความกับผู้เช่า": "Messages with the tenant",
    "เช่น เก้าอี้ห้องส่วนกลางหัก (ไม่บังคับ)": "e.g. broken chair in the common room (optional)", "ไม่เกิน 3 รูป": "up to 3 photos", "รวมในบิลถัดไป": "Add to next bill",
    "เรียกเก็บแยก": "Bill separately", "ออกค่าปรับและแจ้งผู้เช่า": "Issue fine and notify tenant", "กรอกยอดและเหตุผล": "Enter an amount and a reason",
    "ออกค่าปรับแล้ว": "Fine issued", "เรื่อง": "Subject", "ผู้เช่าตอบ {n} ข้อความ": "{n} reply(ies) from the tenant",
    "ยังไม่มีค่าปรับ": "No fines yet", "ออกค่าปรับ": "Issue a fine", "เรียกเก็บ": "Billing",
    "กรณี": "Case", "(ผู้เช่าจะเห็นข้อความนี้)": "(the tenant sees this)", "ยอดใหม่": "New amount",
    "ห้อง {r} · {d}": "Room {r} · {d}", "ยอดเดิม {a}": "Original {a}", "อยู่ในบิล {p}": "On the {p} bill",
    "ลดยอดเป็น": "Reduce to", "บันทึกยอด": "Save amount", "ยืนยันค่าปรับ": "Confirm fine",
    "ยกเลิกค่าปรับ": "Cancel fine", "เช่น C07": "e.g. C07", "อนุมัติแล้ว (เกินโควตา)": "Approved (over quota)",
    "อนุมัติแล้ว": "Approved", "ห้อง {r} มีที่จอด{v}อยู่แล้ว": "Room {r} already has a {v} space", "ห้องนี้มีสิทธิ์อยู่แล้ว {a} ที่ (โควตาห้องละ {b} ที่) · คันเดิม: {c}": "This room already has {a} (quota {b} per room) · current: {c}",
    "ถ้าตกลงให้เพิ่ม ค่าจอดคันนี้จะเข้าบิลเดือนถัดไป": "If you allow it, this vehicle's fee goes on next month's bill", "ยืนยัน เพิ่มเป็น {n} ที่": "Confirm, allow {n}", "อนุมัติ {p} ห้อง {r}": "Approve {p} for room {r}",
    "เลขสติกเกอร์": "Sticker no.", "ช่องจอด": "Space", "อนุมัติ": "Approve",
    "{p} · ห้อง {r}": "{p} · room {r}", "คำขอรออนุมัติ": "Requests to approve", "ช่องจอดที่ใช้อยู่": "Spaces in use",
    "กำลังยกเลิก (ภายใน {n} วัน)": "Being cancelled (within {n} days)", "คิวรอที่จอด": "Parking queue", "ทะเบียน": "Plate",
    "สิทธิ์ที่มี / โควตา": "Has / quota", "ตีกลับคำขอ {p}": "Return request {p}", "ไม่มีคำขอรออนุมัติ": "No requests waiting",
    "การยกเลิกสิทธิ์ที่กำลังดำเนินการ": "Cancellations in progress", "สิ้นสุด": "Ends", "แจ้งแล้ว {d}": "Notified {d}",
    "ผู้เช่ารับทราบ": "Tenant acknowledged", "มีข้อความตอบกลับ": "Tenant replied", "(อีก {n} วัน)": "(in {n} days)",
    "ถอนการยกเลิกแล้ว": "Cancellation withdrawn", "ถอนการยกเลิก": "Withdraw cancellation", "ไม่มีการยกเลิกที่กำลังดำเนินการ": "No cancellations in progress",
    "สติกเกอร์ / ช่อง": "Sticker / space", "ค่าจอด": "Fee", "ยกเลิกสิทธิ์ {p} ห้อง {r}": "Cancel permit {p} of room {r}",
    "เหตุผล (ผู้เช่าจะเห็น)": "Reason (the tenant sees it)", "แจ้งยกเลิกแล้ว ผู้เช่ามีเวลา {n} วัน": "Cancellation sent; the tenant has {n} days", "ยกเลิกสิทธิ์": "Cancel permit",
    "ยังไม่มีสิทธิ์ที่จอด": "No parking permits yet", "{v} · รอตั้งแต่ {d}": "{v} · waiting since {d}", "แจ้งแล้ว": "Notified",
    "แจ้งผู้เช่าแล้ว": "Tenant notified", "ให้สิทธิ์": "Offer space", "ไม่มีคิวรอ": "Nobody waiting",
    "ถึง 23:59": "until 23:59", "ไม่มีบัตรจอดแขกวันนี้": "No guest passes today", "ปิดชั่วคราว เช่น ล้างสระ": "Temporary closure, e.g. pool cleaning",
    "ปิดชั่วคราว": "Temporarily closed", "ครั้งละ {n} นาที": "{n} min per booking", "ใช้อยู่ {n}{c}": "{n}{c} in use",
    "เปิดใช้": "Enabled", "ปิดชั่วคราวแล้ว": "Marked as temporarily closed", "เปิดตามปกติแล้ว": "Open as normal",
    "เลขห้อง": "Room no.", "พื้นที่ส่วนกลาง": "Shared facilities", "ชื่อ": "Name",
    "ตอนนี้": "Now", "ยังไม่มีพื้นที่ (เพิ่มได้ในแท็บตั้งค่าฟีเจอร์)": "No facilities yet (add them in Feature settings)", "การจอง 7 วันข้างหน้า": "Bookings, next 7 days",
    "ไม่มา": "No-show", "ยกเลิกช้า": "Late cancel", "ยกเลิกการจองนี้": "Cancel this booking",
    "ยกเลิกการจองของห้อง {r}?": "Cancel room {r}'s booking?", "ไม่นับเป็นจองแล้วไม่มา": "It does not count as a no-show", "ยังไม่มีการจอง": "No bookings yet",
    "ห้องที่ถูกงดจอง": "Rooms suspended from booking", "ถึง {d}": "until {d}", "ปลดแบนแล้ว": "Suspension lifted",
    "ปลดแบน": "Lift", "ไม่มีห้องที่ถูกงดจอง": "No suspended rooms", "จองแล้วไม่มา {a} ครั้งใน {b} วัน งดจอง {c} วัน (แก้ได้ในแท็บตั้งค่าฟีเจอร์)": "{a} no-shows in {b} days = {c}-day suspension (change in Feature settings)",
    "เพิ่มโควตาพิเศษสัปดาห์นี้": "Extra quota this week", "ปกติห้องละ {n} ครั้ง/สัปดาห์ (จันทร์–อาทิตย์)": "Normally {n} per room per week (Mon–Sun)", "เพิ่มโควตาแล้ว": "Quota added",
    "จำนวนครั้ง": "Count", "เพิ่ม": "Add", "ห้อง {r} +{n}": "room {r} +{n}",
    "เปิด {f} แล้ว": "{f} turned on", "ปิด {f} แล้ว": "{f} turned off", "ฟิตเนสและสระ": "Gym and pool",
    "เช็กอินมีผล (ชั่วโมง)": "Check-in lasts (hours)", "เช็กอินพร้อมกันต่อห้อง (คน)": "Check-ins per room at once", "จองได้ต่อห้องต่อสัปดาห์ (ครั้ง)": "Bookings per room per week",
    "ต้องสแกนยืนยันภายใน (นาทีหลังเวลาเริ่ม)": "Confirm scan within (min after start)", "ยกเลิกโดยไม่นับโทษ ก่อนเวลาเริ่ม (ชั่วโมง)": "Free cancellation before start (hours)", "จองแล้วไม่มากี่ครั้ง จึงงดจอง": "No-shows before suspension",
    "นับภายใน (วัน)": "Counted within (days)", "งดจอง (วัน)": "Suspension (days)", "โควตาต่อห้อง: รถยนต์": "Quota per room: car",
    "โควตาต่อห้อง: มอเตอร์ไซค์": "Quota per room: motorcycle", "ช่องจอดทั้งหมด: รถยนต์": "Total spaces: car", "(0 = ไม่จำกัด)": "(0 = unlimited)",
    "ช่องจอดทั้งหมด: มอเตอร์ไซค์": "Total spaces: motorcycle", "ค่าจอดรถยนต์ (บาท/เดือน)": "Car fee (THB/month)", "ค่าจอดมอเตอร์ไซค์ (บาท/เดือน)": "Motorcycle fee (THB/month)",
    "ระยะยกเลิกสิทธิ์ (วัน)": "Cancellation notice (days)", "บัตรจอดแขกต้องอนุมัติก่อน": "Guest passes need approval", "บันทึกกฎ": "Save rules",
    "บันทึกกฎแล้ว": "Rules saved", "ฟิตเนส": "Gym", "สระว่ายน้ำ": "Swimming pool",
    "ห้องส่วนกลาง (จอง)": "Common room (booking)", "ความจุ {n}": "capacity {n}", "พิมพ์": "Print",
    "เปลี่ยน QR ของ {f}?": "Replace the QR of {f}?", "QR เดิมที่พิมพ์ไว้จะใช้ไม่ได้ทันที ต้องพิมพ์ใหม่": "The printed QR stops working immediately; print the new one.", "เปลี่ยน QR": "New QR",
    "เปลี่ยน QR แล้ว พิมพ์ใบใหม่ได้เลย": "QR replaced — print the new one", "เช่น ห้องประชุมชั้น 1": "e.g. meeting room, 1st floor", "{n} นาที": "{n} min",
    "เปลี่ยนผู้เช่าและสร้างลิงก์ใหม่": "Change tenant and create a new link", "ฟีเจอร์ของหอนี้": "Features of this dorm", "ฟีเจอร์ที่ปิด ผู้เช่าจะไม่เห็นเมนูนั้นเลย และระบบจะไม่รับคำขอของฟีเจอร์นั้น": "Tenants don't see switched-off features at all, and the system rejects their requests.",
    "เช็กอินด้วย QR · ดูจำนวนคน": "QR check-in · live occupancy", "จองช่วงเวลา · สแกนยืนยัน": "Time-slot booking · scan to confirm", "ยื่นขอสิทธิ์ · บัตรจอดแขก · คิวรอ": "Permits · guest passes · queue",
    "บิลออนไลน์": "Online bills", "บิล · แนบสลิป · ใบเสร็จ": "Bills · slips · receipts", "ออกค่าปรับ · ผู้เช่าตอบกลับได้": "Fines · tenants can reply",
    "QR สำหรับพิมพ์": "QR codes to print", "ติดที่โต๊ะคนตรวจหรือหน้าห้อง ผู้เช่าต้องสแกนจากเมนูในลิงก์ห้องเท่านั้น": "Stick them at the desk or the door. Tenants must scan from the menu of their room link.", "ยังไม่มีพื้นที่ส่วนกลาง": "No shared facilities yet",
    "เพิ่มพื้นที่ส่วนกลาง": "Add a facility", "เพิ่มแล้ว": "Added", "ความจุ": "Capacity",
    "ความยาวต่อการจอง": "Booking length", "กฎการใช้งาน": "Rules", "บัตรจอดแขกต้องให้เจ้าของหออนุมัติก่อน": "Guest passes need owner approval",
    "เบอร์ติดต่อเจ้าของหอ (ผู้เช่าเห็น)": "Owner phone (shown to tenants)", "อีเมลติดต่อ (ผู้เช่าเห็น)": "Contact e-mail (shown to tenants)", "เปลี่ยนผู้เช่า": "Change tenant",
    "ลิงก์ใหม่จะเริ่มข้อมูลใหม่ทั้งหมด ลิงก์เดิมใช้ไม่ได้ทันที ข้อมูลของผู้เช่าเดิมย้ายไปเป็น \"ประวัติผู้เช่าก่อนหน้า\" (ไม่ลบ)": "The new link starts from zero and the old link stops working at once. The previous tenant's data moves to \"previous tenants\" history (nothing is deleted).", "อุปกรณ์ที่เข้าสู่ระบบบัญชีนี้": "Devices signed in to this account", "ออกจากระบบอุปกรณ์อื่นได้ทันที เช่น ทำมือถือหาย หรือผู้จัดการเลิกงาน (มีผลกับเซิร์ฟเวอร์ API ทั้ง 2 เครื่องพร้อมกัน)": "Sign other devices out instantly, e.g. a lost phone or a manager who left (applies to both API servers at once).",
    "IP {ip} · ใช้ล่าสุด {d}": "IP {ip} · last used {d}", "เครื่องนี้": "this device", "ออกจากระบบอุปกรณ์นั้นแล้ว": "That device is signed out",
    "ออกจากระบบ {n} อุปกรณ์แล้ว": "{n} device(s) signed out", "ออกจากระบบอุปกรณ์อื่นทั้งหมด": "Sign out all other devices", "สิทธิ์ที่จอด {n} คัน": "{n} parking permit(s)",
    "บัตรจอดแขก {n} ใบ": "{n} guest pass(es)", "การจองห้องส่วนกลางที่ยังไม่ถึงเวลา {n} รายการ": "{n} upcoming booking(s)", "เช็กอินฟิตเนส/สระที่ค้างอยู่ {n}": "{n} active gym/pool check-in(s)",
    "เปลี่ยนผู้เช่าห้อง {r}?": "Change the tenant of room {r}?", "ลิงก์ใหม่จะเริ่มข้อมูลใหม่ทั้งหมด ลิงก์เดิมใช้ไม่ได้ทันที": "The new link starts from zero; the old link stops working at once.", "ระบบจะยกเลิกของผู้เช่าเดิม: {x}": "These will be cancelled for the previous tenant: {x}.",
    "บิลค้าง {a} · ค่าปรับ {b} รายการ · แจ้งซ่อม {c} เรื่อง จะย้ายไปเก็บเป็นประวัติผู้เช่าก่อนหน้า ผู้เช่าใหม่มองไม่เห็น": "Unpaid {a} · {b} fine(s) · {c} repair request(s) move to the previous-tenant history; the new tenant cannot see them.", "ผู้เช่าใหม่ห้อง {r}: คัดลอกลิงก์ใหม่แล้ว": "New tenant for room {r}: new link copied", "ผู้เช่าใหม่ห้อง {r} พร้อมแล้ว ลิงก์ใหม่อยู่ในแท็บห้อง & ลิงก์": "Room {r} is ready for the new tenant; the new link is in Rooms & links",
    "เล็งกล้องไปที่ QR": "Point the camera at the QR", "กำลังอ่าน QR จากรูป…": "Reading the QR from the photo…", "อ่าน QR จากรูปนี้ไม่ได้ ลองรูปที่ชัดขึ้น": "Can't read a QR in this photo — try a sharper one",
    "สแกน QR": "Scan QR", "เลือกรูป QR แทน": "Use a photo of the QR", "เบราว์เซอร์นี้เปิดกล้องไม่ได้ เลือกรูป QR แทนได้": "This browser can't open the camera — use a photo of the QR instead",
    "เปิดกล้องไม่ได้ (ไม่ได้อนุญาต หรือไม่มีกล้อง) เลือกรูป QR แทนได้": "Camera unavailable (not allowed or none) — use a photo of the QR instead", "ห้อง {n} — DormDesk": "Room {n} — DormDesk", "เปลี่ยนผู้เช่า (เริ่มข้อมูลใหม่ทั้งหมด)": "Change tenant (start from zero)",
    "เปลี่ยนผู้เช่าห้อง {room}": "Change the tenant of room {room}", "ลิงก์เก่าจะใช้ไม่ได้ทันที ใช้เมื่อลิงก์หลุด (ผู้เช่าคนเดิม ข้อมูลเดิมอยู่ครบ) ถ้ามีผู้เช่าใหม่ ให้ใช้ปุ่ม \"เปลี่ยนผู้เช่า\"": "The old link stops working at once. Use this when a link leaked (same tenant, data kept). For a new tenant use \"Change tenant\".", "ห้องของฉัน — DormDesk": "My room — DormDesk",
    "ห้องของคุณตอนนี้": "Your room right now", "เมนูห้อง": "Room menu", "สแกนจากลิงก์ห้อง — DormDesk": "Scan from your room link — DormDesk",
    "เปิดลิงก์ห้องของคุณ แล้วสแกนจากเมนูนั้น": "Open your room link and scan from its menu", "QR นี้ใช้เช็กอินหรือยืนยันการจองของหอพัก ต้องสแกนจากในลิงก์ห้องของคุณเท่านั้น ระบบจึงรู้ว่าเป็นห้องไหน": "This QR is for dorm check-in or booking confirmation. Scan it from inside your room link so the system knows which room you are.", "เปิดลิงก์ห้องที่เจ้าของหอส่งให้ (เช่นใน LINE)": "Open the room link your owner sent you (e.g. on LINE)",
    "แตะเมนู \"ส่วนกลาง\"": "Tap the \"Facilities\" menu", "แตะ \"สแกน QR\" แล้วเล็งที่ QR นี้อีกครั้ง": "Tap \"Scan QR\" and point at this QR again", "บิล & ค่าปรับ": "Bills & fines",
    "ตั้งค่าฟีเจอร์": "Feature settings", "เสียงดังรบกวน": "Noise", "อื่น ๆ": "Other",
    "ทะเบียนรถไม่ถูกต้อง": "Invalid licence plate", "อีเมลไม่ถูกต้อง หรือยังไม่ได้ยินยอม": "Invalid e-mail, or consent not given", "QR นี้ไม่ใช่ของ DormDesk": "This is not a DormDesk QR",
    "QR นี้ใช้เช็กอินฟิตเนส/สระของหอนี้ไม่ได้": "This QR is not a gym/pool check-in QR of this dorm", "ไม่พบบัตรเช็กอิน": "Check-in pass not found", "จองล่วงหน้าได้ไม่เกิน 14 วัน": "You can book up to 14 days ahead",
    "ไม่พบห้องส่วนกลาง": "Common room not found", "ห้องนี้ปิดการจองอยู่": "This room is closed for booking", "เวลาไม่ถูกต้อง": "Invalid time",
    "ช่วงเวลานี้จองไม่ได้": "This time slot can't be booked", "งดการจองชั่วคราวเพราะจองแล้วไม่มาครบกำหนด": "Booking suspended because of no-shows", "มีคนจองช่วงนี้ไปแล้ว ลองช่วงอื่น": "Someone just booked this slot — try another",
    "ไม่พบการจอง": "Booking not found", "การจองนี้หมดเวลายืนยันแล้ว": "The confirmation window for this booking has passed", "QR นี้ไม่ใช่ของห้องที่คุณจอง": "This QR is not the room you booked",
    "สแกนยืนยันได้ตั้งแต่ 15 นาทีก่อนเวลาเริ่ม": "You can confirm from 15 minutes before the start", "ไม่พบคำขอที่ถูกตีกลับ": "Returned request not found", "มีคำขอที่รอตรวจอยู่แล้ว": "You already have requests waiting",
    "ไม่พบสิทธิ์ที่จอด": "Parking permit not found", "ขอบัตรจอดแขกได้ล่วงหน้าไม่เกิน 7 วัน": "Guest passes can be requested up to 7 days ahead", "ขอบัตรจอดแขกได้วันละไม่เกิน 2 ใบ": "At most 2 guest passes per day",
    "ห้องนี้อยู่ในคิวแล้ว": "This room is already in the queue", "ไม่มี QR สำหรับบิลนี้": "No QR for this bill", "กรุณาแนบรูปสลิป": "Please attach the slip image",
    "บิลนี้ส่งสลิปไม่ได้ (ชำระแล้ว หรือรอตรวจอยู่)": "You can't send a slip for this bill (paid or under review)", "ไม่พบค่าปรับนี้": "Fine not found", "ยอดเงินไม่ถูกต้อง": "Invalid amount",
    "มีค่าที่อยู่นอกช่วงที่อนุญาต": "A value is outside the allowed range", "เวลาเปิด-ปิดหรือความยาวช่วงจองไม่ถูกต้อง": "Invalid opening hours or booking length", "ความยาวช่วงจองต้องเป็น 30/60/90/120 นาที": "Booking length must be 30/60/90/120 minutes",
    "ไม่พบห้อง": "Room not found", "ยังไม่ได้เปิดฟีเจอร์บิล": "Bills are not switched on", "บิลที่ชำระแล้วแก้ไม่ได้ ให้เพิ่มรายการปรับยอดในบิลถัดไป": "A paid bill cannot be edited; add an adjustment to the next bill",
    "บิลที่ส่งให้ผู้เช่าแล้ว ต้องใส่เหตุผลที่แก้ไข": "This bill was already sent — enter a reason for the change", "บิลยังไม่มียอด": "The bill has no amount yet", "บิลนี้ยืนยันการชำระไม่ได้": "This bill can't be marked as paid",
    "บิลนี้ไม่มีสลิปรอตรวจ": "This bill has no slip to check", "บิลที่ชำระแล้วยกเลิกไม่ได้": "A paid bill can't be cancelled", "ไม่พบสลิป": "Slip not found",
    "สลิปนี้ถูกลบตามระยะเวลาเก็บข้อมูลแล้ว": "This slip was deleted under the data retention policy", "ยังไม่ได้เปิดฟีเจอร์ค่าปรับ": "Fines are not switched on", "ค่าปรับนี้ปิดแล้ว": "This fine is closed",
    "ลดยอดได้ แต่เพิ่มเกินยอดเดิมไม่ได้": "You can reduce it but not raise it above the original", "คำขอนี้ไม่ได้รออนุมัติ": "This request is not waiting for approval", "ห้องนี้มีที่จอดครบโควตาแล้ว": "This room already uses its parking quota",
    "ยกเลิกได้เฉพาะสิทธิ์ที่ใช้งานอยู่": "Only active permits can be cancelled", "สิทธิ์นี้สิ้นสุดไปแล้ว หรือไม่ได้อยู่ระหว่างยกเลิก": "This permit already ended or is not being cancelled", "คิวนี้ไม่ได้รออยู่": "This queue entry is not waiting",
    "หอนี้ไม่ได้เปิดใช้ฟีเจอร์นี้": "This dorm has not switched on this feature", "คำขอนี้กำลังดำเนินการ กรุณารอสักครู่": "This request is being processed, please wait", "ไม่พบเซสชัน": "Session not found",
    "ข้อความต้องยาว 1–1000 ตัวอักษร": "Messages must be 1–1000 characters", "ระบบเก็บรูปไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่": "Image storage is temporarily unavailable, please try again", "ไม่พบข้อมูล": "Not found",
    "ไม่พบรูป": "Image not found",
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
  // server messages with numbers inside (API f-strings)
  const PATTERNS = [
    [/^ห้องนี้เช็กอินครบ (\d+) คนแล้ว/, "This room already has $1 people checked in. One must check out first, or wait for it to expire."],
    [/^สัปดาห์นี้จองครบ (\d+) ครั้งแล้ว$/, "You have used all $1 bookings this week"],
    [/^ที่จอด(.+)เต็ม ลงชื่อรอคิวได้$/, "$1 parking is full — you can join the queue"],
    [/^แนบรูปได้ไม่เกิน (\d+) รูป$/, "Up to $1 photos"],
    [/^รูปรวมกันต้องไม่เกิน (\d+) MB$/, "Photos must be under $1 MB in total"],
    [/^ไม่รู้จักค่า (.+)$/, "Unknown setting $1"], [/^ค่า (.+) ไม่ถูกต้อง$/, "Invalid value for $1"],
  ];
  // server messages like "ข้อมูลไม่ถูกต้อง: title"
  function tMessage(msg) {
    if (lang !== "en" || !msg) return msg;
    const m = /^ข้อมูลไม่ถูกต้อง: (.+)$/.exec(msg);
    if (m) return t("ข้อมูลไม่ถูกต้อง: {f}", { f: m[1] });
    for (const [re, en] of PATTERNS) { const x = re.exec(msg); if (x) return en.replace(/\$(\d)/g, (_, i) => DICT[x[i]] || x[i]); }
    return t(msg);
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
