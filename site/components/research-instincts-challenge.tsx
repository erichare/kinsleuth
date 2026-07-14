"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createResearchInstinctsChallenge } from "../shared/research-instincts-challenge";

export const ResearchInstinctsChallenge = createResearchInstinctsChallenge({
  useEffect,
  useMemo,
  useRef,
  useState
});
