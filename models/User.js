// models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      unique: true,
      index: true,
      required: true
    },

    fullName: {
      type: String,
      required: true
    },

    email: {
      type: String,
      required: true,
      unique: true
    },

    passwordHash: {
      type: String,
      required: true
    },

    role: {
      type: String,
      enum: ["admin", "manager", "employee"],
      required: true
    },

    designation: {
      type: String,
      default: "Employee"
    },

    // ✅ Employee Type (Permanent / Contract / Intern etc.)
employeeType: {
  type: String,
  enum: [
    "Permanent",
    "Contract",
    "Intern",
    "Freelancer",
    "Consultant",
    "Temporary"
  ],
  default: "Permanent"
},



    // NEW: Job Title/Designation with all IT and non-IT roles
    jobTitle: {
      type: String,
      enum: [
        // IT Job Titles
        "Software Engineer",
        "Senior Software Engineer",
        "Software Development Engineer",
        "Full Stack Developer",
        "Frontend Developer",
        "Backend Developer",
        "Web Developer",
        "Mobile App Developer",
        "Android Developer",
        "iOS Developer",
        "DevOps Engineer",
        "Cloud Engineer",
        "AWS Solutions Architect",
        "Azure Developer",
        "Google Cloud Engineer",
        "Site Reliability Engineer",
        "Systems Engineer",
        "Network Engineer",
        "Security Engineer",
        "Cybersecurity Analyst",
        "Penetration Tester",
        "Database Administrator",
        "SQL Developer",
        "Data Engineer",
        "Data Scientist",
        "Data Analyst",
        "Machine Learning Engineer",
        "AI Engineer",
        "Business Intelligence Analyst",
        "QA Engineer",
        "Test Engineer",
        "Automation Test Engineer",
        "Manual Test Engineer",
        "Performance Test Engineer",
        "UI/UX Designer",
        "Product Designer",
        "Graphic Designer",
        "Technical Writer",
        "Documentation Specialist",
        "IT Support Engineer",
        "Help Desk Technician",
        "IT Administrator",
        "System Administrator",
        "Network Administrator",
        "IT Manager",
        "Technical Lead",
        "Team Lead",
        "Project Manager",
        "Scrum Master",
        "Product Manager",
        "Product Owner",
        "Business Analyst",
        "Technical Business Analyst",
        "Solution Architect",
        "Enterprise Architect",
        "CTO",
        "IT Director",
        "VP of Engineering",
        "Software Architect",
        "Engineering Manager",
        
        // Non-IT Job Titles
        "HR Manager",
        "HR Executive",
        "Recruiter",
        "Talent Acquisition Specialist",
        "HR Business Partner",
        "Payroll Administrator",
        "HR Coordinator",
        "Training & Development Manager",
        "Compensation & Benefits Analyst",
        
        "Finance Manager",
        "Accountant",
        "Chartered Accountant",
        "Financial Analyst",
        "Accounts Executive",
        "Accounts Payable Specialist",
        "Accounts Receivable Specialist",
        "Treasury Analyst",
        "Tax Consultant",
        "Auditor",
        "Cost Accountant",
        "Financial Controller",
        "CFO",
        
        "Marketing Manager",
        "Digital Marketing Specialist",
        "SEO Specialist",
        "Social Media Manager",
        "Content Writer",
        "Content Marketer",
        "Brand Manager",
        "Marketing Executive",
        "Marketing Analyst",
        "Public Relations Officer",
        
        "Sales Manager",
        "Sales Executive",
        "Business Development Manager",
        "Account Manager",
        "Sales Representative",
        "Sales Consultant",
        "Customer Success Manager",
        "Inside Sales Representative",
        
        "Operations Manager",
        "Operations Executive",
        "Supply Chain Manager",
        "Logistics Manager",
        "Warehouse Manager",
        "Production Manager",
        "Quality Control Manager",
        
        "Administration Manager",
        "Administrative Assistant",
        "Executive Assistant",
        "Office Manager",
        "Receptionist",
        
        "Legal Counsel",
        "Legal Advisor",
        "Compliance Officer",
        "Company Secretary",
        
        "CEO",
        "Managing Director",
        "Director",
        "General Manager",
        "Assistant Manager",
        "Department Head",
        
        "Intern",
        "Trainee",
        "Fresher",
        "Junior Executive",
        "Senior Executive",
        "Associate",
        "Consultant",
        "Specialist",
        "Expert",
        "Advisor"
      ],
      default: "Software Engineer"
    },

    // Leave configuration fields
    totalLeaveEntitlement: {
      type: Number,
      default: 16
    },

    publicHolidays: {
      type: Number,
      default: 0
    },

    weekendHolidays: {
      type: Number,
      default: 0
    },

    carryForward2025: {
      type: Number,
      default: 0
    },

    mustChangePassword: {
      type: Boolean,
      default: true
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);