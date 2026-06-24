import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./styles.css";
import { ScrollManager } from "./components/site/ScrollManager";
import HomePage from "./pages/Home";
import PricingPage from "./pages/Pricing";
import NotFound from "./pages/NotFound";
import AboutPage from "./pages/About";
import ContactPage from "./pages/Contact";
import ResourcesPage from "./pages/Resources";
import IndustriesPage from "./pages/Industries";
import AttendancePage from "./pages/modules/Attendance";
import PayrollPage from "./pages/modules/Payroll";
import PeoplePage from "./pages/modules/People";
import RecruitmentPage from "./pages/modules/Recruitment";
import AnalyticsPage from "./pages/modules/Analytics";
import ESSPage from "./pages/modules/ESS";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollManager />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/industries" element={<IndustriesPage />} />
        <Route path="/modules/attendance" element={<AttendancePage />} />
        <Route path="/modules/payroll" element={<PayrollPage />} />
        <Route path="/modules/people" element={<PeoplePage />} />
        <Route path="/modules/recruitment" element={<RecruitmentPage />} />
        <Route path="/modules/analytics" element={<AnalyticsPage />} />
        <Route path="/modules/ess" element={<ESSPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
