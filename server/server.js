const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const bcrypt = require("bcryptjs");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" }
}));
app.use(express.static(path.join(__dirname, "..", "public")));

function requireAuth(req,res,next) {
  if (!req.session.user) return res.status(401).json({error:"Not authenticated"});
  next();
}
function requireAdmin(req,res,next) {
  if (!req.session.user || req.session.user.role !== "admin") return res.status(403).json({error:"Admin access required"});
  next();
}
function scopeStudentWhere(user, alias="s") {
  return user.role === "admin" ? "" : ` AND ${alias}.section_id=${Number(user.section_id || 0)}`;
}
function nextStudentId() {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT student_id FROM students WHERE student_id LIKE ? ORDER BY id DESC LIMIT 1").get(`PMM-${year}-%`);
  const n = row ? (parseInt(row.student_id.split("-").pop(),10) || 0) + 1 : 1;
  return `PMM-${year}-${String(n).padStart(5,"0")}`;
}

app.post("/api/login",(req,res)=>{
  const email = String(req.body.email || req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare(`
    SELECT u.id,u.email,u.username,u.password,u.role,u.section_id,s.name AS section_name
    FROM users u LEFT JOIN sections s ON s.id=u.section_id
    WHERE lower(COALESCE(u.email,u.username))=?
  `).get(email);
  if (!user || !bcrypt.compareSync(password,user.password)) return res.status(401).json({error:"Invalid email or password"});
  delete user.password;
  req.session.user=user;
  res.json(user);
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json(req.session.user || null));

app.get("/api/dashboard",requireAuth,(req,res)=>{
  const scope=scopeStudentWhere(req.session.user);
  const totalStudents=db.prepare(`SELECT COUNT(*) c FROM students s WHERE s.active=1 ${scope}`).get().c;
  const today=new Date().toISOString().slice(0,10);
  const presentToday=db.prepare(`
    SELECT COUNT(*) c FROM attendance a JOIN students s ON s.id=a.student_id
    WHERE a.date=? AND a.status='Present' ${scope}
  `).get(today).c;
  const totalAttendance=db.prepare(`
    SELECT COUNT(*) c FROM attendance a JOIN students s ON s.id=a.student_id WHERE 1=1 ${scope}
  `).get().c;
  const sections=req.session.user.role==="admin" ? db.prepare("SELECT COUNT(*) c FROM sections").get().c : 1;
  res.json({totalStudents,presentToday,totalAttendance,sections});
});

app.get("/api/sections",requireAdmin,(req,res)=>{
  res.json(db.prepare("SELECT * FROM sections ORDER BY name").all());
});
app.post("/api/sections",requireAdmin,(req,res)=>{
  const name=String(req.body.name||"").trim();
  const description=String(req.body.description||"").trim();
  if(!name) return res.status(400).json({error:"Section name is required"});
  try {
    const r=db.prepare("INSERT INTO sections(name,description) VALUES(?,?)").run(name,description);
    res.json(db.prepare("SELECT * FROM sections WHERE id=?").get(r.lastInsertRowid));
  } catch { res.status(400).json({error:"Section already exists"}); }
});

app.get("/api/users",requireAdmin,(req,res)=>{
  res.json(db.prepare(`
    SELECT u.id,u.email,u.username,u.role,u.section_id,s.name section_name,u.created_at
    FROM users u LEFT JOIN sections s ON s.id=u.section_id ORDER BY u.id DESC
  `).all());
});
app.post("/api/users",requireAdmin,(req,res)=>{
  const email=String(req.body.email||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  const sectionId=Number(req.body.sectionId);
  if(!email || !password || !sectionId) return res.status(400).json({error:"Email, password and section are required"});
  if(password.length<6) return res.status(400).json({error:"Password must be at least 6 characters"});
  const section=db.prepare("SELECT * FROM sections WHERE id=?").get(sectionId);
  if(!section) return res.status(400).json({error:"Section not found"});
  try {
    const hash=bcrypt.hashSync(password,10);
    const r=db.prepare("INSERT INTO users(email,username,password,role,section_id) VALUES(?,?,?,'section',?)")
      .run(email,email,hash,sectionId);
    const u=db.prepare("SELECT id,email,role,section_id FROM users WHERE id=?").get(r.lastInsertRowid);
    res.json(u);
  } catch { res.status(400).json({error:"Email already exists"}); }
});
app.delete("/api/users/:id",requireAdmin,(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if(!u || u.role==="admin") return res.status(400).json({error:"Admin account cannot be removed"});
  db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.get("/api/students",requireAuth,(req,res)=>{
  const scope=scopeStudentWhere(req.session.user);
  res.json(db.prepare(`
    SELECT s.*, sec.name section_name FROM students s
    LEFT JOIN sections sec ON sec.id=s.section_id
    WHERE 1=1 ${scope} ORDER BY s.id DESC
  `).all());
});
app.post("/api/students",requireAuth,(req,res)=>{
  const u=req.session.user;
  const name=String(req.body.name||"").trim();
  if(!name) return res.status(400).json({error:"Student name is required"});
  const sectionId=u.role==="admin" ? Number(req.body.sectionId) : Number(u.section_id);
  if(!sectionId) return res.status(400).json({error:"Student section is required"});
  const section=db.prepare("SELECT id FROM sections WHERE id=?").get(sectionId);
  if(!section) return res.status(400).json({error:"Section not found"});
  const studentId=String(req.body.studentId||"").trim() || nextStudentId();
  const qrToken=crypto.randomUUID();
  try {
    const r=db.prepare(`
      INSERT INTO students(student_id,name,school_name,email,phone,class_name,section_id,qr_token)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(studentId,name,String(req.body.schoolName||"").trim(),String(req.body.email||"").trim(),
      String(req.body.phone||"").trim(),String(req.body.className||"").trim(),sectionId,qrToken);
    res.json(db.prepare("SELECT * FROM students WHERE id=?").get(r.lastInsertRowid));
  } catch { res.status(400).json({error:"Student ID already exists"}); }
});
app.put("/api/students/:id",requireAuth,(req,res)=>{
  const u=req.session.user;
  const existing=db.prepare("SELECT * FROM students WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Student not found"});
  if(u.role!=="admin" && existing.section_id!==u.section_id) return res.status(403).json({error:"Access denied"});
  const sectionId=u.role==="admin" ? Number(req.body.sectionId||existing.section_id) : u.section_id;
  db.prepare(`
    UPDATE students SET student_id=?,name=?,school_name=?,email=?,phone=?,class_name=?,section_id=? WHERE id=?
  `).run(String(req.body.studentId||existing.student_id).trim(),String(req.body.name||"").trim(),
    String(req.body.schoolName||""),String(req.body.email||""),String(req.body.phone||""),
    String(req.body.className||""),sectionId,req.params.id);
  res.json(db.prepare("SELECT * FROM students WHERE id=?").get(req.params.id));
});
app.get("/api/students/:studentId/qr",requireAuth,async(req,res)=>{
  const s=db.prepare("SELECT s.*,sec.name section_name FROM students s LEFT JOIN sections sec ON sec.id=s.section_id WHERE s.student_id=?").get(req.params.studentId);
  if(!s) return res.status(404).json({error:"Student not found"});
  if(req.session.user.role!=="admin" && s.section_id!==req.session.user.section_id) return res.status(403).json({error:"Access denied"});
  const dataUrl=await QRCode.toDataURL(`PMM-STUDENT:${s.student_id}:${s.qr_token}`);
  res.json({dataUrl,student:s});
});

app.get("/api/courses",requireAuth,(req,res)=>{
  const u=req.session.user;
  const rows=u.role==="admin" ? db.prepare("SELECT c.*,s.name section_name FROM courses c LEFT JOIN sections s ON s.id=c.section_id ORDER BY c.name").all()
    : db.prepare("SELECT c.*,s.name section_name FROM courses c LEFT JOIN sections s ON s.id=c.section_id WHERE c.section_id=? OR c.section_id IS NULL ORDER BY c.name").all(u.section_id);
  res.json(rows);
});
app.post("/api/courses",requireAdmin,(req,res)=>{
  const name=String(req.body.name||"").trim(), sectionId=Number(req.body.sectionId)||null;
  if(!name) return res.status(400).json({error:"Course name is required"});
  const r=db.prepare("INSERT INTO courses(name,section_id) VALUES(?,?)").run(name,sectionId);
  res.json(db.prepare("SELECT * FROM courses WHERE id=?").get(r.lastInsertRowid));
});

app.post("/api/attendance/scan",requireAuth,(req,res)=>{
  const raw=String(req.body.qr||"");
  let studentId=raw;
  if(raw.startsWith("PMM-STUDENT:")) studentId=raw.split(":")[1];
  else if(raw.startsWith("ATTENDANCE:")) studentId=raw.replace("ATTENDANCE:","");
  const s=db.prepare("SELECT * FROM students WHERE student_id=? AND active=1").get(studentId);
  if(!s) return res.status(404).json({error:"Student not found"});
  if(req.session.user.role!=="admin" && s.section_id!==req.session.user.section_id) return res.status(403).json({error:"This student belongs to another section"});
  const courseId=req.body.courseId ? Number(req.body.courseId) : null;
  const course=courseId ? db.prepare("SELECT * FROM courses WHERE id=?").get(courseId) : null;
  const now=new Date(), date=now.toISOString().slice(0,10), time=now.toTimeString().slice(0,8);
  const exists=db.prepare("SELECT id FROM attendance WHERE student_id=? AND date=? AND course_id IS ?").get(s.id,date,courseId);
  if(exists) return res.status(409).json({error:"Attendance already recorded today",student:s});
  const r=db.prepare("INSERT INTO attendance(student_id,course_id,date,time,status,method,recorded_by) VALUES(?,?,?,?,?,?,?)")
    .run(s.id,courseId,date,time,"Present","QR",req.session.user.id);
  res.json({message:"Attendance recorded",attendanceId:r.lastInsertRowid,student:s,course});
});

app.post("/api/attendance/manual",requireAuth,(req,res)=>{
  const {courseId,date,presentStudentIds}=req.body;
  if(!courseId||!date||!Array.isArray(presentStudentIds)) return res.status(400).json({error:"Course, date and student list are required"});
  const u=req.session.user;
  const course=db.prepare("SELECT * FROM courses WHERE id=?").get(courseId);
  if(!course) return res.status(404).json({error:"Course not found"});
  if(u.role!=="admin" && course.section_id!==null && course.section_id!==u.section_id) return res.status(403).json({error:"Access denied"});
  const scope=scopeStudentWhere(u);
  const all=db.prepare(`SELECT * FROM students s WHERE s.active=1 ${scope} ORDER BY name`).all();
  const set=new Set(presentStudentIds.map(Number)), now=new Date(), time=now.toTimeString().slice(0,8);
  const find=db.prepare("SELECT id FROM attendance WHERE student_id=? AND date=? AND course_id=?");
  const ins=db.prepare("INSERT INTO attendance(student_id,course_id,date,time,status,method,recorded_by) VALUES(?,?,?,?,?,?,?)");
  const upd=db.prepare("UPDATE attendance SET time=?,status=?,method='Manual',recorded_by=? WHERE id=?");
  const tx=db.transaction(()=>{
    for(const s of all){
      const ex=find.get(s.id,date,courseId);
      const status=set.has(s.id)?"Present":"Absent";
      if(ex) upd.run(time,status,u.id,ex.id);
      else ins.run(s.id,courseId,date,time,status,"Manual",u.id);
    }
  });
  tx();
  res.json({message:"Manual attendance saved",saved:all.length});
});

app.get("/api/attendance",requireAuth,(req,res)=>{
  const u=req.session.user, {date,studentId,courseId}=req.query;
  let sql=`SELECT a.id,s.student_id studentCode,s.name,s.school_name,s.class_name,sec.name section_name,c.name course,a.date,a.time,a.status,a.method
           FROM attendance a JOIN students s ON s.id=a.student_id LEFT JOIN sections sec ON sec.id=s.section_id
           LEFT JOIN courses c ON c.id=a.course_id WHERE 1=1`;
  const p={};
  if(u.role!=="admin"){sql+=" AND s.section_id=@sectionId";p.sectionId=u.section_id;}
  if(date){sql+=" AND a.date=@date";p.date=date;}
  if(studentId){sql+=" AND s.student_id=@studentId";p.studentId=studentId;}
  if(courseId){sql+=" AND a.course_id=@courseId";p.courseId=courseId;}
  sql+=" ORDER BY a.date DESC,a.time DESC";
  res.json(db.prepare(sql).all(p));
});
app.get("/api/attendance/csv",requireAuth,(req,res)=>{
  const u=req.session.user;
  const rows=db.prepare(`
    SELECT s.student_id,s.name,s.school_name,s.class_name,sec.name section_name,c.name course,a.date,a.time,a.status,a.method
    FROM attendance a JOIN students s ON s.id=a.student_id LEFT JOIN sections sec ON sec.id=s.section_id
    LEFT JOIN courses c ON c.id=a.course_id
    ${u.role==="admin"?"":"WHERE s.section_id=?"}
    ORDER BY a.date DESC,a.time DESC
  `).all(...(u.role==="admin"?[]:[u.section_id]));
  const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;
  const csv=[["Student ID","Name","School","Class","Section","Course","Date","Time","Status","Method"],...rows.map(r=>[r.student_id,r.name,r.school_name,r.class_name,r.section_name,r.course,r.date,r.time,r.status,r.method])]
    .map(r=>r.map(esc).join(",")).join("\n");
  res.setHeader("Content-Type","text/csv");res.setHeader("Content-Disposition",'attachment; filename="attendance.csv"');res.send(csv);
});

app.get("*splat",(req,res)=>res.sendFile(path.join(__dirname,"..","public","index.html")));
app.listen(PORT,()=>console.log(`Project Mercy Student Attendance running at http://localhost:${PORT}`));
