// ============================================================
// DOLAN SAWAH AI
// RECIPE ENGINE
// ============================================================

import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc
} from "firebase/firestore";

import { db } from "./firebase";

import {
  COLLECTIONS,
  createRecipe
} from "./dataModel";

// ============================================================
// GET ALL RECIPES
// ============================================================

export async function getRecipes() {
  const snapshot = await getDocs(
    collection(db, COLLECTIONS.RECIPES)
  );

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
}

// ============================================================
// FIND RECIPE BY MENU NAME
// ============================================================

export async function findRecipeByMenuName(
  menuName
) {
  const recipes = await getRecipes();

  const normalized =
    String(menuName || "")
      .trim()
      .toLowerCase();

  return (
    recipes.find(
      (recipe) =>
        String(recipe.menuName || "")
          .trim()
          .toLowerCase() === normalized
    ) || null
  );
}

// ============================================================
// SAVE RECIPE
// ============================================================

export async function saveRecipe(data) {
  if (!data.menuName) {
    throw new Error(
      "Nama menu wajib diisi."
    );
  }

  if (
    !Array.isArray(data.ingredients) ||
    data.ingredients.length === 0
  ) {
    throw new Error(
      "Resep harus memiliki minimal satu bahan."
    );
  }

  const recipe =
    createRecipe(data);

  const ref = collection(
    db,
    COLLECTIONS.RECIPES
  );

  const docRef =
    await addDoc(ref, recipe);

  return {
    id: docRef.id,
    ...recipe
  };
}

// ============================================================
// UPDATE RECIPE
// ============================================================

export async function updateRecipe(id, data) {
  if (!id) {
    throw new Error(
      "ID resep tidak valid."
    );
  }

  if (!data.menuName) {
    throw new Error(
      "Nama menu wajib diisi."
    );
  }

  if (
    !Array.isArray(data.ingredients) ||
    data.ingredients.length === 0
  ) {
    throw new Error(
      "Resep harus memiliki minimal satu bahan."
    );
  }

  const payload = {
    menuName: data.menuName,
    ingredients: data.ingredients,
    portions: Number(data.portions || 1),
    updatedAt: new Date().toISOString()
  };

  await updateDoc(
    doc(db, COLLECTIONS.RECIPES, id),
    payload
  );

  return {
    id,
    ...payload
  };
}

// ============================================================
// DELETE RECIPE
// ============================================================

export async function deleteRecipe(id) {
  if (!id) {
    throw new Error(
      "ID resep tidak valid."
    );
  }

  await deleteDoc(
    doc(db, COLLECTIONS.RECIPES, id)
  );
}

// ============================================================
// CALCULATE INGREDIENT USAGE
// ============================================================

export function calculateRecipeUsage(
  recipe,
  portions
) {
  if (!recipe) {
    return [];
  }

  const qty =
    Number(portions || 0);

  if (qty <= 0) {
    return [];
  }

  return recipe.ingredients.map(
    (ingredient) => ({
      itemId:
        ingredient.itemId || "",

      itemName:
        ingredient.itemName || "",

      unit:
        ingredient.unit || "",

      quantityPerPortion:
        Number(
          ingredient.quantity || 0
        ),

      totalQuantity:
        Number(
          ingredient.quantity || 0
        ) * qty
    })
  );
}

// ============================================================
// CALCULATE USAGE FROM SALES
// ============================================================

export function calculateUsageFromSales(
  sales,
  recipes
) {
  const usageMap = {};

  for (const sale of sales) {
    const menuName =
      String(
        sale.menuName || ""
      )
        .trim()
        .toLowerCase();

    const recipe =
      recipes.find(
        (r) =>
          String(
            r.menuName || ""
          )
            .trim()
            .toLowerCase() ===
          menuName
      );

    if (!recipe) {
      continue;
    }

    const portions =
      Number(
        sale.quantity || 0
      );

    for (
      const ingredient
      of recipe.ingredients
    ) {
      const key =
        ingredient.itemId ||
        ingredient.itemName;

      if (!usageMap[key]) {
        usageMap[key] = {
          itemId:
            ingredient.itemId || "",

          itemName:
            ingredient.itemName || "",

          unit:
            ingredient.unit || "",

          quantity: 0,

          sourceMenus: []
        };
      }

      const usage =
        Number(
          ingredient.quantity || 0
        ) * portions;

      usageMap[key].quantity +=
        usage;

      if (
        !usageMap[key].sourceMenus.includes(
          sale.menuName
        )
      ) {
        usageMap[key].sourceMenus.push(
          sale.menuName
        );
      }
    }
  }

  return Object.values(
    usageMap
  );
}

// ============================================================
// RECIPE VALIDATION
// ============================================================

export function validateRecipe(
  recipe
) {
  const errors = [];

  if (!recipe.menuName) {
    errors.push(
      "Nama menu belum tersedia."
    );
  }

  if (
    !Array.isArray(
      recipe.ingredients
    ) ||
    recipe.ingredients.length === 0
  ) {
    errors.push(
      "Belum ada bahan dalam resep."
    );
  }

  if (
    Array.isArray(
      recipe.ingredients
    )
  ) {
    recipe.ingredients.forEach(
      (ingredient, index) => {
        if (
          !ingredient.itemName &&
          !ingredient.itemId
        ) {
          errors.push(
            `Bahan ke-${index + 1} belum memiliki nama.`
          );
        }

        if (
          Number(
            ingredient.quantity
          ) <= 0
        ) {
          errors.push(
            `Jumlah bahan ke-${index + 1} harus lebih dari 0.`
          );
        }

        if (!ingredient.unit) {
          errors.push(
            `Satuan bahan ke-${index + 1} belum tersedia.`
          );
        }
      }
    );
  }

  return {
    valid:
      errors.length === 0,

    errors
  };
}

// ============================================================
// RECIPE COST
// ============================================================

export function calculateRecipeCost(
  recipe,
  items
) {
  if (!recipe) {
    return {
      totalCost: 0,
      ingredients: []
    };
  }

  const details =
    recipe.ingredients.map(
      (ingredient) => {
        const item =
          items.find(
            (i) =>
              (
                i.id ===
                ingredient.itemId
              ) ||
              (
                String(
                  i.name || ""
                ).toLowerCase() ===
                String(
                  ingredient.itemName ||
                  ""
                ).toLowerCase()
              )
          );

        const price =
          Number(
            item?.currentPrice || 0
          );

        const quantity =
          Number(
            ingredient.quantity || 0
          );

        const cost =
          price * quantity;

        return {
          itemId:
            ingredient.itemId || "",

          itemName:
            ingredient.itemName || "",

          unit:
            ingredient.unit || "",

          quantity,

          price,

          cost
        };
      }
    );

  const totalCost =
    details.reduce(
      (sum, item) =>
        sum + item.cost,
      0
    );

  return {
    totalCost,
    ingredients: details
  };
}

// ============================================================
// BUILD RECIPE SUMMARY
// ============================================================

export function buildRecipeSummary(
  recipe,
  items = []
) {
  const validation =
    validateRecipe(recipe);

  const cost =
    calculateRecipeCost(
      recipe,
      items
    );

  return {
    menuName:
      recipe.menuName,

    valid:
      validation.valid,

    errors:
      validation.errors,

    ingredientCount:
      recipe.ingredients?.length ||
      0,

    totalCost:
      cost.totalCost,

    ingredients:
      cost.ingredients
  };
}