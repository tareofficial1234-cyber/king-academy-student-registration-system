const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const START_PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const uploadDir = path.join(ROOT, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });

const db = new Database(path.join(ROOT, 'data', 'king-academy.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  gender TEXT NOT NULL,
  date_of_birth TEXT,
  grade TEXT NOT NULL,
  program TEXT,
  academic_year TEXT,
  admission_date TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  photo TEXT,
  document TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  academic_year TEXT NOT NULL,
  grade TEXT NOT NULL,
  subject TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 100,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, academic_year, subject),
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);
`);

function log(action, description) { db.prepare('INSERT INTO activity_logs(action,description) VALUES(?,?)').run(action, description); }
function currentAcademicYear() { const d = new Date(); const y = d.getFullYear(); const start = d.getMonth() >= 8 ? y : y - 1; return `${start}/${String(start + 1).slice(-2)}`; }
function yearList() { const y = parseInt(currentAcademicYear(), 10); return [currentAcademicYear(), `${y-1}/${String(y).slice(-2)}`, `${y-2}/${String(y-1).slice(-2)}`, '2025/26', '2024/25'].filter((v,i,a)=>a.indexOf(v)===i); }
function addColumn(table, column, definition) { const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name); if(!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
addColumn('students','academic_year','TEXT');
addColumn('students','admission_date','TEXT');

const grades = ['KG 1','KG 2','KG 3','KG 4','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
const defaultSubjects = ['English','Mathematics','Amharic','Science','Social Studies','Environmental Science','Creative Arts','Biology','Chemistry','Physics','Civics','Geography','History','ICT','Physical Education','Afarigna'];
const subjects = defaultSubjects;
const allowedStatuses = ['Pending','Approved','Rejected','Cancelled'];
const storage = multer.diskStorage({destination:(_req,_file,cb)=>cb(null,uploadDir),filename:(_req,file,cb)=>cb(null,`${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)});
const upload = multer({storage,limits:{fileSize:5*1024*1024}});

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||'king-academy-change-this-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:false,maxAge:8*60*60*1000}}));
app.use('/uploads',express.static(uploadDir));
app.use(express.static(path.join(ROOT,'public')));
function auth(req,res,next){if(req.session.user)return next();res.status(401).json({error:'Authentication required'});}

function nextRegistrationId(){
  const year=new Date().getFullYear();
  const rows=db.prepare("SELECT registration_id FROM students WHERE registration_id LIKE ? ORDER BY id DESC LIMIT 1").get(`KA${year}%`);
  let n=1; if(rows){const m=rows.registration_id.match(/(\d{4})$/);if(m)n=parseInt(m[1],10)+1;}
  return `KA${year}${String(n).padStart(4,'0')}`;
}
function gradeSortValue(g){if(g.startsWith('KG '))return Number(g.slice(3));return 4+Number(g.replace('Grade ',''));}
function studentName(s){return [s.first_name,s.middle_name,s.last_name].filter(Boolean).join(' ');}
function resultForStudent(studentId, academicYear){
  const student=db.prepare('SELECT * FROM students WHERE id=?').get(studentId);
  if(!student)return null;
  const rows=db.prepare('SELECT * FROM marks WHERE student_id=? AND academic_year=? ORDER BY subject').all(studentId,academicYear);
  const total=rows.reduce((a,r)=>a+Number(r.score),0);
  const maxTotal=rows.reduce((a,r)=>a+Number(r.max_score),0);
  const average=maxTotal?total/maxTotal*100:0;
  return {student,academic_year:academicYear,marks:rows,total,max_total:maxTotal,average:Number(average.toFixed(2)),subjects_count:rows.length,result:rows.length?(average>=50?'PASS':'FAIL'):'NO MARKS'};
}
function rankedResults(academicYear, grade){
  let studentsSql='SELECT * FROM students WHERE 1=1', params=[];
  if(grade){studentsSql+=' AND grade=?';params.push(grade);}
  const students=db.prepare(studentsSql).all(...params);
  const rows=students.map(s=>resultForStudent(s.id,academicYear)).filter(x=>x&&x.marks.length>0).sort((a,b)=>b.average-a.average || b.total-a.total || studentName(a.student).localeCompare(studentName(b.student)));
  let lastAvg=null,lastTotal=null,rank=0;
  rows.forEach((r,i)=>{if(lastAvg!==r.average||lastTotal!==r.total)rank=i+1;r.rank=rank;lastAvg=r.average;lastTotal=r.total;});
  return rows;
}

const seedCount=db.prepare('SELECT COUNT(*) c FROM students').get().c;
if(seedCount===0){
  const insert=db.prepare(`INSERT INTO students(registration_id,first_name,middle_name,last_name,gender,date_of_birth,grade,program,academic_year,admission_date,phone,email,address,guardian_name,guardian_phone,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const seed=[
    ['KA20260001','Tesfaye','Alemu','Alemu','Male','2009-06-12','Grade 10','Natural Science','2026/27','2026-09-01','+251 911 234567','tesfaye@example.com','Sodo','Alemu Tesfaye','+251 911 100001','Approved'],
    ['KA20260002','Hana','Getachew','Getachew','Female','2008-09-22','Grade 11','Social Science','2026/27','2026-09-01','+251 912 345678','hana@example.com','Sodo','Getachew Bekele','+251 912 100002','Pending'],
    ['KA20260003','Mekdes','Abebe','Abebe','Female','2010-01-18','Grade 9','General','2026/27','2026-09-01','+251 913 456789','mekdes@example.com','Sodo','Abebe Girma','+251 913 100003','Approved'],
    ['KA20260004','Daniel','Tadesse','Tadesse','Male','2008-04-07','Grade 12','Natural Science','2026/27','2026-09-01','+251 914 567890','daniel@example.com','Sodo','Tadesse Kassa','+251 914 100004','Pending'],
    ['KA20260005','Sara','Mohammed','Mohammed','Female','2009-12-03','Grade 10','Social Science','2026/27','2026-09-01','+251 915 678901','sara@example.com','Sodo','Mohammed Ali','+251 915 100005','Approved']
  ];
  seed.forEach(s=>insert.run(...s));
  db.prepare("INSERT INTO activity_logs(action,description) VALUES('System initialized','King Academy registration and academic marks/report-card module created')").run();
}

app.post('/api/login',(req,res)=>{const {username,password}=req.body;if(username==='admin'&&password==='admin123'){req.session.user={username:'admin',role:'Administrator'};log('Login','Administrator signed in');return res.json({ok:true,user:req.session.user});}res.status(401).json({error:'Invalid username or password'});});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>res.json({authenticated:!!req.session.user,user:req.session.user||null}));
app.get('/api/options',(req,res)=>{const custom=db.prepare('SELECT name FROM subjects ORDER BY name').all().map(x=>x.name);res.json({grades,academic_years:yearList(),subjects:[...new Set([...defaultSubjects,...custom])]});});
app.post('/api/subjects',auth,(req,res)=>{const name=String(req.body.name||'').trim();if(!name||name.length>100)return res.status(400).json({error:'Course name is required.'});db.prepare('INSERT OR IGNORE INTO subjects(name) VALUES(?)').run(name);log('Course added',name);res.json({ok:true,name});});
app.get('/api/mark-students',auth,(req,res)=>{const q=String(req.query.q||'').trim();if(!q)return res.json([]);const v=`%${q}%`;res.json(db.prepare(`SELECT id,registration_id,first_name,middle_name,last_name,grade,academic_year FROM students WHERE first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ? OR registration_id LIKE ? ORDER BY first_name,last_name LIMIT 20`).all(v,v,v,v));});

app.get('/api/dashboard',auth,(req,res)=>{
  const stats={total:db.prepare('SELECT COUNT(*) c FROM students').get().c,pending:db.prepare("SELECT COUNT(*) c FROM students WHERE status='Pending'").get().c,approved:db.prepare("SELECT COUNT(*) c FROM students WHERE status='Approved'").get().c,rejected:db.prepare("SELECT COUNT(*) c FROM students WHERE status='Rejected'").get().c,cancelled:db.prepare("SELECT COUNT(*) c FROM students WHERE status='Cancelled'").get().c,today:db.prepare("SELECT COUNT(*) c FROM students WHERE date(created_at)=date('now','localtime')").get().c};
  const byGrade=db.prepare('SELECT grade,COUNT(*) count FROM students GROUP BY grade').all().sort((a,b)=>gradeSortValue(a.grade)-gradeSortValue(b.grade));
  const recent=db.prepare('SELECT * FROM students ORDER BY id DESC LIMIT 8').all();
  const activities=db.prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 8').all();
  const academic=rankedResults(currentAcademicYear());
  const top=academic.slice(0,5).map(x=>({id:x.student.id,name:studentName(x.student),grade:x.student.grade,average:x.average,rank:x.rank}));
  res.json({stats,byGrade,recent,activities,topAcademic:top});
});

app.get('/api/students',auth,(req,res)=>{const q=(req.query.q||'').trim(),status=req.query.status||'',grade=req.query.grade||'',academic_year=req.query.academic_year||'';let sql='SELECT * FROM students WHERE 1=1',p=[];if(q){sql+=' AND (first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ? OR registration_id LIKE ? OR phone LIKE ? OR email LIKE ?)';const v=`%${q}%`;p.push(v,v,v,v,v,v)}if(status){sql+=' AND status=?';p.push(status)}if(grade){sql+=' AND grade=?';p.push(grade)}if(academic_year){sql+=' AND academic_year=?';p.push(academic_year)}sql+=' ORDER BY id DESC';res.json(db.prepare(sql).all(...p));});
app.get('/api/students/:id',auth,(req,res)=>{const row=db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);row?res.json(row):res.status(404).json({error:'Student not found'});});
app.post('/api/students',auth,upload.fields([{name:'photo',maxCount:1},{name:'document',maxCount:1}]),(req,res)=>{const b=req.body;if(!b.first_name||!b.last_name||!b.gender||!b.grade)return res.status(400).json({error:'First name, last name, gender and grade are required.'});if(!grades.includes(b.grade))return res.status(400).json({error:'Invalid grade.'});const registration_id=nextRegistrationId(),photo=req.files?.photo?.[0]?.filename||null,document=req.files?.document?.[0]?.filename||null;const r=db.prepare(`INSERT INTO students(registration_id,first_name,middle_name,last_name,gender,date_of_birth,grade,program,academic_year,admission_date,phone,email,address,guardian_name,guardian_phone,status,photo,document,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(registration_id,b.first_name,b.middle_name||'',b.last_name,b.gender,b.date_of_birth||'',b.grade,b.program||'General',b.academic_year||currentAcademicYear(),b.admission_date||new Date().toISOString().slice(0,10),b.phone||'',b.email||'',b.address||'',b.guardian_name||'',b.guardian_phone||'',b.status||'Pending',photo,document,b.notes||'');log('New student registered',`${b.first_name} ${b.last_name} (${registration_id})`);res.status(201).json(db.prepare('SELECT * FROM students WHERE id=?').get(r.lastInsertRowid));});
app.put('/api/students/:id',auth,upload.fields([{name:'photo',maxCount:1},{name:'document',maxCount:1}]),(req,res)=>{const old=db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);if(!old)return res.status(404).json({error:'Student not found'});const b=req.body,photo=req.files?.photo?.[0]?.filename||old.photo,document=req.files?.document?.[0]?.filename||old.document;if(!grades.includes(b.grade))return res.status(400).json({error:'Invalid grade.'});db.prepare(`UPDATE students SET first_name=?,middle_name=?,last_name=?,gender=?,date_of_birth=?,grade=?,program=?,academic_year=?,admission_date=?,phone=?,email=?,address=?,guardian_name=?,guardian_phone=?,status=?,photo=?,document=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(b.first_name,b.middle_name||'',b.last_name,b.gender,b.date_of_birth||'',b.grade,b.program||'General',b.academic_year||currentAcademicYear(),b.admission_date||old.admission_date||'',b.phone||'',b.email||'',b.address||'',b.guardian_name||'',b.guardian_phone||'',b.status||old.status,photo,document,b.notes||'',req.params.id);log('Registration edited',`${b.first_name} ${b.last_name} (${old.registration_id})`);res.json(db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id));});
app.patch('/api/students/:id/status',auth,(req,res)=>{const row=db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);if(!row)return res.status(404).json({error:'Student not found'});if(!allowedStatuses.includes(req.body.status))return res.status(400).json({error:'Invalid status'});db.prepare('UPDATE students SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status,req.params.id);log(`Registration ${req.body.status.toLowerCase()}`,`${studentName(row)} (${row.registration_id})`);res.json({ok:true});});
app.delete('/api/students/:id',auth,(req,res)=>{const row=db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);if(!row)return res.status(404).json({error:'Student not found'});db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);log('Student deleted',`${studentName(row)} (${row.registration_id})`);res.json({ok:true});});

app.get('/api/marks',auth,(req,res)=>{const student_id=Number(req.query.student_id||0),academic_year=req.query.academic_year||'';if(!student_id)return res.status(400).json({error:'student_id is required'});let sql='SELECT m.*,s.registration_id,s.first_name,s.middle_name,s.last_name FROM marks m JOIN students s ON s.id=m.student_id WHERE m.student_id=?',p=[student_id];if(academic_year){sql+=' AND m.academic_year=?';p.push(academic_year)}sql+=' ORDER BY m.subject';res.json(db.prepare(sql).all(...p));});
app.post('/api/marks',auth,(req,res)=>{const b=req.body;const student=db.prepare('SELECT * FROM students WHERE id=?').get(b.student_id);if(!student)return res.status(404).json({error:'Student not found'});const score=Number(b.score),max=Number(b.max_score||100);if(!b.academic_year||!b.subject||Number.isNaN(score)||score<0||max<=0||score>max)return res.status(400).json({error:'Academic year, subject and a valid score are required.'});db.prepare(`INSERT INTO marks(student_id,academic_year,grade,subject,score,max_score,remark,updated_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(student_id,academic_year,subject) DO UPDATE SET grade=excluded.grade,score=excluded.score,max_score=excluded.max_score,remark=excluded.remark,updated_at=CURRENT_TIMESTAMP`).run(student.id,b.academic_year,student.grade,b.subject,score,max,b.remark||'');log('Yearly mark saved',`${studentName(student)} — ${b.subject} (${b.academic_year})`);res.json({ok:true,result:resultForStudent(student.id,b.academic_year)});});
app.delete('/api/marks/:id',auth,(req,res)=>{const m=db.prepare('SELECT * FROM marks WHERE id=?').get(req.params.id);if(!m)return res.status(404).json({error:'Mark not found'});db.prepare('DELETE FROM marks WHERE id=?').run(req.params.id);log('Yearly mark deleted',`Mark ${m.subject} (${m.academic_year})`);res.json({ok:true});});
app.get('/api/marks/report/:studentId',auth,(req,res)=>{const student=db.prepare('SELECT * FROM students WHERE id=?').get(req.params.studentId);if(!student)return res.status(404).json({error:'Student not found'});const rows=db.prepare('SELECT * FROM marks WHERE student_id=? ORDER BY academic_year DESC,subject').all(student.id);const grouped={};rows.forEach(r=>(grouped[r.academic_year]??=[]).push(r));const years=Object.keys(grouped).map(year=>{const r=resultForStudent(student.id,year);const ranked=rankedResults(year,student.grade);const me=ranked.find(x=>x.student.id===student.id);return {...r,rank:me?.rank||null,class_size:ranked.length};});res.json({student,years});});

app.get('/api/results',auth,(req,res)=>{const academic_year=req.query.academic_year||currentAcademicYear(),grade=req.query.grade||'';const rows=rankedResults(academic_year,grade);res.json({academic_year,grade,rows});});
app.get('/api/student-results/:id',auth,(req,res)=>{const student=db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);if(!student)return res.status(404).json({error:'Student not found'});const years=[...new Set(db.prepare('SELECT academic_year FROM marks WHERE student_id=? ORDER BY academic_year DESC').all(student.id).map(x=>x.academic_year))];const history=years.map(y=>{const r=resultForStudent(student.id,y);const ranked=rankedResults(y,student.grade);const me=ranked.find(x=>x.student.id===student.id);return {...r,rank:me?.rank||null,class_size:ranked.length};});res.json({student,history});});
app.get('/api/report-card/:studentId',auth,(req,res)=>{const student=db.prepare('SELECT * FROM students WHERE id=?').get(req.params.studentId);if(!student)return res.status(404).json({error:'Student not found'});const year=req.query.academic_year||student.academic_year||currentAcademicYear();const r=resultForStudent(student.id,year);const ranked=rankedResults(year,student.grade);const me=ranked.find(x=>x.student.id===student.id);res.json({...r,rank:me?.rank||null,class_size:ranked.length,school:'KING ACADEMY SCHOOL'});});

function csvResponse(res,rows,filename){const headers=Object.keys(rows[0]||{Registration_ID:'Registration ID'});const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;const csv=[headers.join(','),...rows.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\n');res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);res.send(csv);}
app.get('/api/export.csv',auth,(req,res)=>csvResponse(res,db.prepare('SELECT registration_id,first_name,middle_name,last_name,gender,date_of_birth,grade,program,academic_year,admission_date,phone,email,address,guardian_name,guardian_phone,status,created_at FROM students ORDER BY id DESC').all(),'king-academy-students.csv'));
app.get('/api/export-marks.csv',auth,(req,res)=>{const rows=rankedResults(req.query.academic_year||currentAcademicYear(),req.query.grade||'').map(x=>({registration_id:x.student.registration_id,student_name:studentName(x.student),grade:x.student.grade,academic_year:x.academic_year,total:x.total,max_total:x.max_total,average:x.average,rank:x.rank,result:x.result,subjects:x.subjects_count}));csvResponse(res,rows,'king-academy-yearly-results.csv');});
app.get('/api/export-subject-marks.csv',auth,(req,res)=>{const rows=db.prepare(`SELECT s.registration_id,s.first_name||' '||s.last_name AS student_name,s.grade,m.academic_year,m.subject,m.score,m.max_score,ROUND(m.score*100.0/m.max_score,2) AS percentage,m.remark FROM marks m JOIN students s ON s.id=m.student_id ORDER BY s.grade,s.last_name,s.first_name,m.academic_year,m.subject`).all();csvResponse(res,rows,'king-academy-subject-marks.csv');});

app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));
function startServer(port){const server=app.listen(port,()=>console.log('King Academy Registration System running at http://localhost:'+port));server.on('error',err=>{if(err.code==='EADDRINUSE'&&port<START_PORT+20){console.log(`Port ${port} is already in use. Trying port ${port+1}...`);startServer(port+1);}else{console.error(err);process.exit(1);}});}
startServer(START_PORT);
