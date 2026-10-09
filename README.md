# King Academy School — Student Registration & Academic Management System

A local web-based student registration, student ID, yearly marks, ranking and report-card system based on the supplied King Academy dashboard design.

## Main modules

- Admin login
- Dashboard and registration statistics
- Student registration from **KG 1, KG 2, KG 3, KG 4, Grade 1 through Grade 12**
- Automatic permanent Student ID generation, e.g. `KA20260001`
- Student profile, guardian information, photo and supporting document upload
- Search/filter by name, Student ID, grade and status
- Registration status: Pending, Approved, Rejected, Cancelled
- Printable individual and batch Student ID Cards
- **Yearly Marks & Results**
  - Select student
  - Select academic year
  - Enter each subject separately
  - Enter maximum mark and remark
  - Update an existing student/year/subject mark without duplicates
- **Automatic yearly calculations**
  - Total marks
  - Total possible marks
  - Average percentage
  - Number of subjects
  - Rank within the same grade and academic year
  - Pass / Fail result (50% threshold)
- **Academic history** for every student across multiple years
- **Class ranking report** by academic year and grade
- **Printable annual report card** with student details, subject marks, total, average, rank and result
- Export yearly result summaries to CSV
- Export detailed subject marks to CSV
- Student registration CSV export
- Activity logs
- Responsive dashboard based on the supplied reference image
- SQLite database in `data/king-academy.db`

## Academic marks workflow

1. Open **Yearly Marks**.
2. Select the student.
3. Select the academic year.
4. Enter the mark for every subject that applies to the student.
5. Enter the maximum mark (normally 100).
6. Add an optional remark.
7. Click **Save All Marks**.
8. The system automatically calculates the student's total and average.
9. The student's rank is calculated against students in the same grade and academic year who have marks.
10. Open **Reports** to see the class ranking or print an annual report card.

### Example

| Subject | Mark |
|---|---:|
| Mathematics | 85 |
| English | 78 |
| Biology | 91 |
| Chemistry | 82 |
| Physics | 88 |

The system calculates the yearly total and average automatically. You do **not** need to type the total or average manually.

## Ranking rule

Ranking is calculated separately for each **academic year + grade**. Students are sorted by average percentage, then total marks. Students with the same average and total receive the same rank.

## Report card

From **Reports**, choose an academic year and grade. Each student with marks can have an annual report card printed. The report card contains:

- King Academy School heading
- Student photo (when uploaded)
- Student name
- Student ID
- Grade / level
- Gender
- Academic year
- Each subject mark
- Maximum mark
- Percentage
- Remark
- Total
- Average
- Rank / class size
- Pass / Fail result
- Teacher and Principal signature lines

## Requirements

- Node.js 18 or newer
- Internet connection on first setup if npm needs to download dependencies

## Windows setup

1. Extract the ZIP.
2. Open the project folder.
3. Double-click `start.bat`.
4. The script installs dependencies and starts the server.
5. Open the URL printed in the terminal. The default is `http://localhost:3000`.

If port 3000 is already in use, the server automatically tries 3001, 3002, and so on.

## Linux / macOS

```bash
chmod +x start.sh
./start.sh
```

## Login

- Username: `admin`
- Password: `admin123`

Change the credentials and session secret before production deployment.

## Student ID generation

New students receive:

`KA + admission year + four-digit sequence`

Examples: `KA20260001`, `KA20260002`, `KA20260003`.

## Data storage

The SQLite database is created automatically in `data/king-academy.db`. Student photos and supporting documents are stored in `uploads/`.


### Flexible Yearly Mark Entry
The Yearly Marks screen now includes a Quick Yearly Mark Entry section. Admin can type/select a registered student name (or Student ID), choose the academic year, type any course/subject name, enter the mark and maximum mark, and save immediately. Course names are no longer limited to the built-in subject list; new course names are saved and become available for future entries.

## Render deployment: keep student data after redeploys

The application uses SQLite. To keep student records and uploaded files between Render deployments, the Render web service must have a **persistent disk** attached. Merely setting `MONGODB_URI` does not change this project, because this code does not use MongoDB.

1. In the Render dashboard, open this web service and add a persistent disk. Use `/var/data` as its mount path. Persistent disks may require a paid Render plan; check Render's current plan and pricing before enabling one.
2. In the service's Environment settings, add these variables:
   - `DATA_DIR` = `/var/data`
   - `UPLOAD_DIR` = `/var/data/uploads`
   - `SESSION_SECRET` = a long, random secret value of your own
3. Save the settings and redeploy the service.
4. Register one test student, then redeploy once more and verify the student is still present before entering more records.

The app will create `/var/data/king-academy.db` on the persistent disk. Student photos and supporting documents will be saved under `/var/data/uploads`.

**Important:** Do not add a new empty database or delete any existing database until you have checked whether the old student records can be recovered. This ZIP does not include `data/king-academy.db`, so it cannot restore records that were already lost. If an existing database backup is available, keep a separate copy before restoring it.

The student-registration pages, marks, rankings, reports, exports, and existing API routes have not been intentionally redesigned or replaced by this storage-path change.

