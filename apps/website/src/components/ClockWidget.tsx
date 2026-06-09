import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, MapPin, Play, Square, CheckCircle2, Navigation, Wifi } from 'lucide-react';

interface ClockWidgetProps {
  employeeName: string;
  onClockInSuccess: (time: string, method: string) => void;
  onClockOutSuccess: (time: string, duration: string) => void;
  lastLog?: { clockIn: string; clockOut?: string };
}

export default function ClockWidget({ employeeName, onClockInSuccess, onClockOutSuccess, lastLog }: ClockWidgetProps) {
  const [time, setTime] = useState(new Date());
  const [isClockedIn, setIsClockedIn] = useState(!!lastLog && !lastLog.clockOut);
  const [clockInTime, setClockInTime] = useState<Date | null>(lastLog && !lastLog.clockOut ? new Date() : null); // Mock starting time
  const [elapsed, setElapsed] = useState('');
  const [workMode, setWorkMode] = useState<'Office' | 'Remote'>('Office');
  const [radarScanning, setRadarScanning] = useState(false);
  const [gpsLocked, setGpsLocked] = useState(true);

  const trackerInterval = useRef<NodeJS.Timeout | null>(null);

  // Live digital clock loop
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // Duration stopwatch when clocked in
  useEffect(() => {
    if (isClockedIn && clockInTime) {
      trackerInterval.current = setInterval(() => {
        const diff = new Date().getTime() - clockInTime.getTime();
        const hrs = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setElapsed(
          `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        );
      }, 1000);
    } else {
      if (trackerInterval.current) {
        clearInterval(trackerInterval.current);
      }
      setElapsed('');
    }

    return () => {
      if (trackerInterval.current) clearInterval(trackerInterval.current);
    };
  }, [isClockedIn, clockInTime]);

  const handleClockIn = () => {
    setRadarScanning(true);
    // Simulate GPS verification
    setTimeout(() => {
      setRadarScanning(false);
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setIsClockedIn(true);
      setClockInTime(now);
      onClockInSuccess(timeStr, workMode === 'Office' ? 'Office Geofenced Wi-Fi' : 'GPS Loc: 19.076, 72.877');
    }, 1500);
  };

  const handleClockOut = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setIsClockedIn(false);
    onClockOutSuccess(timeStr, elapsed || "00:00:15");
    setClockInTime(null);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Mock static location coordinate depending on choice
  const getCoordinatesStr = () => {
    if (workMode === 'Office') return "HQ Portal Gateway (WiFi Link-A)";
    return "GPS: 19.0761° N, 72.8777° E (Mumbai Hub)";
  };

  return (
    <div id="clocking-module" className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between h-full min-h-[350px]">
      <div>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Attendance Portal</h3>
            <span className="text-[10px] text-slate-400 font-medium">Verify daily presence metrics</span>
          </div>
          <div className="flex gap-1.5 p-0.5 bg-slate-100 rounded-lg">
            <button
              onClick={() => !isClockedIn && setWorkMode('Office')}
              disabled={isClockedIn}
              className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all ${
                workMode === 'Office' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-900 disabled:opacity-50'
              }`}
            >
              Office
            </button>
            <button
              onClick={() => !isClockedIn && setWorkMode('Remote')}
              disabled={isClockedIn}
              className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all ${
                workMode === 'Remote' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-900 disabled:opacity-50'
              }`}
            >
              Remote
            </button>
          </div>
        </div>

        {/* Real-time Ticking Clock rendering */}
        <div className="text-center py-6 bg-slate-50 rounded-xl relative overflow-hidden border border-slate-100">
          <AnimatePresence mode="wait">
            {radarScanning && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-indigo-900/10 backdrop-blur-xs flex flex-col items-center justify-center z-10"
              >
                <div className="w-12 h-12 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin mb-2" />
                <span className="text-[10px] font-bold text-indigo-800 uppercase tracking-widest font-mono">Running Geo-Scans...</span>
              </motion.div>
            )}
          </AnimatePresence>

          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block font-mono">
            {formatDate(time)}
          </span>
          <span className="text-3xl font-extrabold text-slate-800 tabular-nums block tracking-tight my-1">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>

          <div className="flex items-center justify-center gap-1.5 mt-2 text-[10px] font-medium text-slate-500">
            {workMode === 'Office' ? (
              <Wifi className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <MapPin className="w-3.5 h-3.5 text-indigo-500 animate-bounce" />
            )}
            <span className="font-mono">{getCoordinatesStr()}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {/* Status indicator */}
        {isClockedIn ? (
          <div className="bg-green-50 border border-green-100 rounded-xl p-3 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-ping" />
              <div>
                <span className="text-[10px] font-semibold text-slate-400 block uppercase font-mono">Clocked In Session</span>
                <span className="text-xs font-bold text-slate-700">Since {lastLog?.clockIn || "Today"}</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[9px] font-mono block text-slate-400">Worked Today</span>
              <span className="text-sm font-extrabold text-slate-800 font-mono tracking-tight">{elapsed || '00:00:00'}</span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-100 border border-slate-200/60 rounded-xl p-3 text-center">
            <span className="text-xs text-slate-500 font-medium">You have not clocked in yet today.</span>
          </div>
        )}

        {/* Buttons Action */}
        {!isClockedIn ? (
          <button
            id="click-main-clockin"
            onClick={handleClockIn}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-100 hover:shadow-indigo-200 transition-all flex items-center justify-center gap-2 text-xs"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>Clock In Session</span>
          </button>
        ) : (
          <button
            id="click-main-clockout"
            onClick={handleClockOut}
            className="w-full py-3.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg shadow-red-100 hover:shadow-red-200 transition-all flex items-center justify-center gap-2 text-xs"
          >
            <Square className="w-4 h-4 fill-white text-white" />
            <span>Clock Out Session</span>
          </button>
        )}
      </div>
    </div>
  );
}
