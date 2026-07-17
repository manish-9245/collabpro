"use client"
import Image from "next/image";
import Header from "./_components/Header";
import Hero from "./_components/Hero";
import { useSessionAuth } from "@/lib/session-auth/client";
import { useEffect } from "react";

export default function Home() {

  const {user}=useSessionAuth();

  useEffect(()=>{
    console.log("--",user)
  },[user?.email])
  return (
    <div>
      <Header/>
      <Hero/>
    </div>
  );
}
