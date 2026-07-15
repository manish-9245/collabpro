"use client";
import React, { useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

export const BackgroundBeams = React.memo(
  ({ className }: { className?: string }) => {
    const beams = [
      {
        d: "M-10 100 L400 300 L800 100 L1200 400 L1600 200",
        duration: 12,
        delay: 0,
      },
      {
        d: "M100 -50 L300 400 L700 200 L1100 600 L1500 100 L1800 300",
        duration: 15,
        delay: 2,
      },
      {
        d: "M-50 300 L500 100 L900 500 L1300 200 L1700 400",
        duration: 18,
        delay: 4,
      },
      {
        d: "M200 600 L600 300 L1000 600 L1400 300 L1900 700",
        duration: 14,
        delay: 1,
      },
    ];

    const containerRef = useRef<HTMLDivElement>(null);
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    useEffect(() => {
      const handleMouseMove = (event: MouseEvent) => {
        if (!containerRef.current) return;
        const { left, top } = containerRef.current.getBoundingClientRect();
        mouseX.set(event.clientX - left);
        mouseY.set(event.clientY - top);
      };

      window.addEventListener("mousemove", handleMouseMove);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
      };
    }, [mouseX, mouseY]);

    return (
      <div
        ref={containerRef}
        className={cn(
          "absolute inset-0 overflow-hidden bg-transparent pointer-events-none z-0",
          className
        )}
      >
        <svg
          className="absolute w-full h-full"
          viewBox="0 0 1600 800"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="beam-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0" />
              <stop offset="50%" stopColor="#6366f1" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="beam-grad-2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0" />
              <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="8" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {beams.map((beam, idx) => (
            <React.Fragment key={idx}>
              {/* Static faint path */}
              <path
                d={beam.d}
                fill="none"
                stroke="url(#beam-grad-1)"
                strokeWidth="1"
                className="opacity-10"
              />
              {/* Animated glowing pulse */}
              <motion.path
                d={beam.d}
                fill="none"
                stroke={idx % 2 === 0 ? "url(#beam-grad-1)" : "url(#beam-grad-2)"}
                strokeWidth="3"
                filter="url(#glow)"
                initial={{ strokeDasharray: "0 1000", strokeDashoffset: 0 }}
                animate={{
                  strokeDasharray: ["150 1000", "150 1000"],
                  strokeDashoffset: [-1200, 1200],
                }}
                transition={{
                  duration: beam.duration,
                  repeat: Infinity,
                  ease: "linear",
                  delay: beam.delay,
                }}
              />
            </React.Fragment>
          ))}
        </svg>

        {/* Dynamic Interactive Cursor Glow */}
        <motion.div
          className="absolute w-[400px] h-[400px] bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-purple-500/10 rounded-full blur-3xl pointer-events-none"
          style={{
            x: useTransform(mouseX, (val) => val - 200),
            y: useTransform(mouseY, (val) => val - 200),
          }}
        />
      </div>
    );
  }
);

BackgroundBeams.displayName = "BackgroundBeams";
